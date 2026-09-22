import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commandAvailable,
  installArtifact,
  packArtifact,
  REPO_ROOT,
  tryRunCli
} from "./helpers/packed-install.js";

const dockerAvailable = commandAvailable("docker", ["info"]);
const uvAvailable = commandAvailable("uv", ["--version"]);

const VERIFY_SCRIPT = `import os

from sqlmodel import Session, SQLModel, create_engine, select

from models import Post, Priority, Role, User


def main() -> None:
    engine = create_engine(os.environ["DATABASE_URL"])
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(
            email="ada@example.com",
            name="Ada",
            role=Role.ADMIN,
            priority=Priority.HIGH,
            tags=["x", "y"],
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        assert user.id is not None, "expected a generated uuid primary key"
        assert user.createdAt is not None, "expected the server timestamp default"
        assert user.updatedAt is not None, "expected the client timestamp default"
        assert user.priority == Priority.HIGH

        first = Post(title="hello", published=True, user=user)
        second = Post(title="world", user=user)
        assert second.published is False
        session.add(first)
        session.add(second)
        session.commit()

        users = session.exec(select(User)).all()
        posts = session.exec(select(Post)).all()
        assert len(users) == 1
        assert len(posts) == 2
        assert users[0].posts is not None and len(users[0].posts) == 2
        assert posts[0].user.id == user.id
        print(f"users={len(users)} posts={len(posts)} role={users[0].role.value}")


if __name__ == "__main__":
    main()
`;

const USER_SCHEMA_VERIFY_SCRIPT = `import os
from datetime import date, datetime

from sqlalchemy import text as sa_text
from sqlmodel import Session, SQLModel, create_engine, select

from models import Article, Company, Filing, FilingChunk


def main() -> None:
    engine = create_engine(os.environ["DATABASE_URL"])
    SQLModel.metadata.create_all(engine)
    now = datetime(2026, 1, 1, 12, 0, 0)
    with Session(engine) as session:
        company = Company(isin="US0000000000", name="Acme", createdAt=now, updatedAt=now)
        session.add(company)
        session.commit()
        session.refresh(company)

        filing = Filing(
            companyId=company.id,
            title="10-K",
            data={"form": "10-K"},
            filingDate=date(2026, 1, 1),
            sourceUrl="https://example.com/filing/1",
            status="processed",
            createdAt=now,
            updatedAt=now,
        )
        session.add(filing)
        session.commit()
        session.refresh(filing)

        article = Article(
            companyId=company.id,
            filingId=filing.id,
            title="Summary",
            content={"blocks": []},
            fullPrompt={"prompt": "summarize"},
            authors=["ada"],
            editors=[],
            createdAt=now,
            updatedAt=now,
        )
        session.add(article)
        chunks = [
            FilingChunk(
                filingId=filing.id,
                ordinal=index,
                kind="text",
                text=f"chunk {index}",
                searchText=f"chunk {index}",
                tokenCount=2,
                chunkHash=f"hash-{index}",
                createdAt=now,
                updatedAt=now,
            )
            for index in range(2)
        ]
        session.add_all(chunks)
        session.commit()
        session.refresh(article)

        companies = session.exec(select(Company)).all()
        filings = session.exec(select(Filing)).all()
        articles = session.exec(select(Article)).all()
        stored_chunks = session.exec(select(FilingChunk)).all()
        assert len(companies) == 1
        assert len(filings) == 1
        assert len(articles) == 1
        assert len(stored_chunks) == 2
        assert articles[0].id is not None, "expected the gen_random_uuid server default"
        assert articles[0].company.id == company.id
        assert len(companies[0].articles) == 1
        assert len(filings[0].chunks) == 2
        assert stored_chunks[0].filing.id == filing.id

    with engine.connect() as connection:
        gin_indexes = connection.execute(
            sa_text(
                "select indexname from pg_indexes "
                "where schemaname = 'public' and tablename = 'article' "
                "and indexdef ilike '%using gin%'"
            )
        ).all()
        assert len(gin_indexes) == 4, f"expected 4 gin indexes, got {gin_indexes}"
        named_unique = connection.execute(
            sa_text(
                "select conname from pg_constraint "
                "where conrelid = 'public.company'::regclass and conname = 'pgcompany_isin'"
            )
        ).all()
        assert len(named_unique) == 1, "expected the exact pgcompany_isin constraint name"

    print(f"companies={len(companies)} filings={len(filings)} articles={len(articles)} chunks={len(stored_chunks)}")


if __name__ == "__main__":
    main()
`;

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function waitForPostgres(containerName: string, timeoutMs = 120000): void {
  const started = Date.now();
  for (;;) {
    try {
      execFileSync("docker", ["exec", containerName, "pg_isready", "-U", "postgres"], {
        stdio: "ignore"
      });
      return;
    } catch {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`Postgres container ${containerName} never became ready.`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
}

describe.runIf(dockerAvailable && uvAvailable)("online integration", () => {
  let binPath = "";
  let prefix = "";

  beforeAll(async () => {
    const packDir = await mkdtemp(path.join(os.tmpdir(), "psg-pack-online-"));
    try {
      const tarball = packArtifact(packDir);
      prefix = await mkdtemp(path.join(os.tmpdir(), "psg-prefix-online-"));
      binPath = installArtifact(tarball, prefix);
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  }, 180000);

  afterAll(async () => {
    await rm(prefix, { recursive: true, force: true });
  });

  it(
    "validates generated models against live Postgres",
    async () => {
      await runLiveRoundtrip(binPath, "basic-postgres.json", VERIFY_SCRIPT, "users=1 posts=2 role=admin");
    },
    600000
  );

  it(
    "validates the ported user schema against live Postgres",
    async () => {
      await runLiveRoundtrip(
        binPath,
        "user-schema.json",
        USER_SCHEMA_VERIFY_SCRIPT,
        "companies=1 filings=1 articles=1 chunks=2"
      );
    },
    600000
  );
});

async function runLiveRoundtrip(
  binPath: string,
  fixture: string,
  verifyScript: string,
  marker: string
): Promise<void> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "psg-online-"));
  const containerName = `psg-${randomUUID().slice(0, 8)}`;
  try {
    const outDir = path.join(workspace, "generated");
    const generated = tryRunCli(binPath, [
      "--contract",
      path.join(REPO_ROOT, "tests", "fixtures", "contracts", fixture),
      "--output",
      outDir,
      "--no-emit-init"
    ]);
    expect(generated.status).toBe(0);

    const port = await getFreePort();
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "-d",
        "--name",
        containerName,
        "-e",
        "POSTGRES_PASSWORD=postgres",
        "-p",
        `127.0.0.1:${port}:5432`,
        "postgres:16-alpine"
      ],
      { encoding: "utf8" }
    );
    waitForPostgres(containerName);

    execFileSync("uv", ["venv", "--python", "3.12", path.join(workspace, ".venv")], {
      encoding: "utf8"
    });
    const venvPython = path.join(workspace, ".venv", "bin", "python");
    execFileSync(
      "uv",
      ["pip", "install", "--python", venvPython, "sqlmodel", "psycopg[binary]"],
      { encoding: "utf8" }
    );

    await writeFile(path.join(outDir, "verify.py"), verifyScript);
    const stdout = execFileSync(venvPython, ["verify.py"], {
      cwd: outDir,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: `postgresql+psycopg://postgres:postgres@127.0.0.1:${port}/postgres`
      }
    });
    expect(stdout).toContain(marker);
  } finally {
    try {
      execFileSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
    } catch {
      // The container may never have started; nothing to clean up.
    }
    await rm(workspace, { recursive: true, force: true });
  }
}
