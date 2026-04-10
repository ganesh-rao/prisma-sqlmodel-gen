import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const dockerAvailable = commandAvailable("docker", ["info"]);
const uvAvailable = commandAvailable("uv", ["--version"]);
const prismaAvailable = commandAvailable("npx", ["prisma", "--version"]);

const postgresSchema = `datasource db {
  provider = "postgresql"
}

generator sqlmodel {
  provider = "node __GENERATOR_PATH__"
  output   = "./generated/sqlmodel"
}

enum Role {
  ADMIN
  USER
}

model User {
  id           Int       @id @default(autoincrement())
  email        String    @unique @db.VarChar(255)
  role         Role      @default(USER)
  posts        Post[]
  createdAt    DateTime  @default(now()) @db.Timestamptz(6)

  @@map("users")
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String   @db.VarChar(200)
  authorId  Int      @map("author_id")
  author    User     @relation(fields: [authorId], references: [id])

  @@index([authorId], map: "posts_author_id_idx")
}`;

const mysqlSchema = `datasource db {
  provider = "mysql"
}

generator sqlmodel {
  provider = "node __GENERATOR_PATH__"
  output   = "./generated/sqlmodel"
}

model Device {
  id         Int      @id @default(autoincrement())
  serial     String   @unique @db.VarChar(64)
  payload    Bytes?   @db.VarBinary(255)
  amount     Decimal  @db.Decimal(10, 2)
  createdAt  DateTime @db.DateTime(3)
}`;

const postgresQueryParitySchema = `datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client"
  output   = "./generated/prisma"
}

generator sqlmodel {
  provider = "node __GENERATOR_PATH__"
  output   = "./generated/sqlmodel"
}

enum UserStatus {
  ACTIVE
  INACTIVE
}

enum MembershipRole {
  OWNER
  MEMBER
}

enum TaskState {
  TODO
  IN_PROGRESS
  DONE
}

model User {
  id             Int          @id @default(autoincrement())
  email          String       @unique @db.VarChar(255)
  status         UserStatus   @default(ACTIVE)
  managerId      Int?         @map("manager_id")
  manager        User?        @relation("ManagementChain", fields: [managerId], references: [id])
  reports        User[]       @relation("ManagementChain")
  profile        Profile?
  memberships    Membership[]
  assignedTasks  Task[]       @relation("TaskAssignee")
  reportedTasks  Task[]       @relation("TaskReporter")
  comments       Comment[]
  createdAt      DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)

  @@map("users")
}

model Profile {
  userId       Int    @id @map("user_id")
  displayName  String @map("display_name") @db.VarChar(120)
  timezone     String @db.VarChar(64)
  user         User   @relation(fields: [userId], references: [id])

  @@map("profiles")
}

model Team {
  id           Int          @id @default(autoincrement())
  slug         String       @unique @db.VarChar(64)
  memberships  Membership[]
  projects     Project[]

  @@map("teams")
}

model Membership {
  userId    Int            @map("user_id")
  teamId    Int            @map("team_id")
  role      MembershipRole
  joinedAt  DateTime       @default(now()) @map("joined_at") @db.Timestamptz(6)
  user      User           @relation(fields: [userId], references: [id])
  team      Team           @relation(fields: [teamId], references: [id])

  @@id([userId, teamId])
  @@index([teamId, role], map: "membership_team_role_idx")
  @@map("team_memberships")
}

model Project {
  id        Int      @id @default(autoincrement())
  teamId    Int      @map("team_id")
  code      String   @db.VarChar(32)
  archived  Boolean  @default(false)
  team      Team     @relation(fields: [teamId], references: [id])
  tasks     Task[]

  @@unique([teamId, code], map: "project_team_code_key")
  @@map("projects")
}

model Task {
  id             Int        @id @default(autoincrement())
  projectId      Int        @map("project_id")
  assigneeId     Int?       @map("assignee_id")
  reporterId     Int        @map("reporter_id")
  title          String     @db.VarChar(200)
  state          TaskState  @default(TODO)
  priority       Int
  estimateHours  Decimal?   @map("estimate_hours") @db.Decimal(6, 2)
  dueAt          DateTime?  @map("due_at") @db.Timestamptz(6)
  project        Project    @relation(fields: [projectId], references: [id])
  assignee       User?      @relation("TaskAssignee", fields: [assigneeId], references: [id])
  reporter       User       @relation("TaskReporter", fields: [reporterId], references: [id])
  comments       Comment[]

  @@index([projectId, state, priority], map: "task_project_state_priority_idx")
  @@map("tasks")
}

model Comment {
  id         Int       @id @default(autoincrement())
  taskId     Int       @map("task_id")
  authorId   Int       @map("author_id")
  body       String    @db.VarChar(500)
  flagged    Boolean   @default(false)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  task       Task      @relation(fields: [taskId], references: [id])
  author     User      @relation(fields: [authorId], references: [id])

  @@index([taskId, flagged], map: "comment_task_flagged_idx")
  @@map("comments")
}`;

describe.runIf(dockerAvailable && uvAvailable && prismaAvailable)("docker-backed integration", () => {
  it(
    "runs prisma generate twice and validates generated SQLModel against Postgres on Python 3.11 and 3.12",
    async () => {
      for (const pythonVersion of ["3.11", "3.12"]) {
        await withTempWorkspace(async (tmpDir) => {
          const postgresPort = await getFreePort();
          const containerName = `psg-${randomUUID().slice(0, 8)}`;
          const databaseUrl = `postgresql+psycopg://postgres:postgres@127.0.0.1:${postgresPort}/schemasync`;

          try {
            run("docker", [
              "run",
              "--rm",
              "-d",
              "--name",
              containerName,
              "-e",
              "POSTGRES_PASSWORD=postgres",
              "-e",
              "POSTGRES_USER=postgres",
              "-e",
              "POSTGRES_DB=schemasync",
              "-p",
              `127.0.0.1:${postgresPort}:5432`,
              "postgres:16-alpine"
            ]);

            waitForContainer(containerName, ["pg_isready", "-U", "postgres", "-d", "schemasync"]);
            const generatedDir = await generateIntoWorkspace(tmpDir, postgresSchema);
            const firstOutput = await readFile(path.join(generatedDir, "models.py"), "utf8");
            run("npx", ["prisma", "generate", "--schema", path.join(tmpDir, "schema.prisma")]);
            const secondOutput = await readFile(path.join(generatedDir, "models.py"), "utf8");
            expect(secondOutput).toBe(firstOutput);

            const pythonPath = await createPythonEnv(tmpDir, pythonVersion, ["sqlmodel", "psycopg[binary]"]);
            const validationScript = `
import sys
from sqlalchemy import inspect
from sqlmodel import SQLModel, create_engine

sys.path.insert(0, ${JSON.stringify(generatedDir)})
import models

engine = create_engine(${JSON.stringify(databaseUrl)})
SQLModel.metadata.create_all(engine)
inspector = inspect(engine)
tables = set(inspector.get_table_names())
assert "users" in tables, tables
assert "Post" in tables, tables
indexes = inspector.get_indexes("Post")
assert any(index["name"] == "posts_author_id_idx" for index in indexes), indexes
columns = {column["name"]: column for column in inspector.get_columns("users")}
assert "role" in columns, columns
print(models.User.__tablename__)
print(sorted(tables))
`;

            run(pythonPath, ["-c", validationScript], {
              env: {
                ...process.env,
                DATABASE_URL: databaseUrl
              }
            });
          } finally {
            safeRemoveContainer(containerName);
          }
        });
      }
    },
    300_000
  );

  it(
    "runs prisma generate and validates generated SQLModel against MySQL on Python 3.12",
    async () => {
      await withTempWorkspace(async (tmpDir) => {
        const mysqlPort = await getFreePort();
        const containerName = `myg-${randomUUID().slice(0, 8)}`;
        const databaseUrl = `mysql+mysqlconnector://root:root@127.0.0.1:${mysqlPort}/schemasync`;

        try {
          run("docker", [
            "run",
            "--rm",
            "-d",
            "--name",
            containerName,
            "-e",
            "MYSQL_ROOT_PASSWORD=root",
            "-e",
            "MYSQL_DATABASE=schemasync",
            "-p",
            `127.0.0.1:${mysqlPort}:3306`,
            "mysql:8.0"
          ]);

          waitForContainer(containerName, [
            "sh",
            "-lc",
            "mysqladmin ping -h127.0.0.1 -uroot -proot --silent && mysql -h127.0.0.1 -uroot -proot -e 'SELECT 1' schemasync"
          ]);
          const generatedDir = await generateIntoWorkspace(tmpDir, mysqlSchema);
          const pythonPath = await createPythonEnv(tmpDir, "3.12", ["sqlmodel", "mysql-connector-python"]);
          const validationScript = `
import sys
from sqlalchemy import inspect
from sqlmodel import SQLModel, create_engine

sys.path.insert(0, ${JSON.stringify(generatedDir)})
import models

engine = create_engine(${JSON.stringify(databaseUrl)})
SQLModel.metadata.create_all(engine)
inspector = inspect(engine)
tables = set(inspector.get_table_names())
assert "Device" in tables, tables
columns = {column["name"]: column for column in inspector.get_columns("Device")}
assert set(columns) == {"id", "serial", "payload", "amount", "createdAt"}, columns
print(sorted(tables))
`;

          run(pythonPath, ["-c", validationScript], {
            env: {
              ...process.env,
              DATABASE_URL: databaseUrl
            }
          });
        } finally {
          safeRemoveContainer(containerName);
        }
      });
    },
    240_000
  );

  it(
    "matches a complex Prisma query against the equivalent SQLModel query on Postgres",
    async () => {
      await withTempWorkspace(async (tmpDir) => {
        const postgresPort = await getFreePort();
        const containerName = `pqp-${randomUUID().slice(0, 8)}`;
        const prismaDatabaseUrl = `postgresql://postgres:postgres@127.0.0.1:${postgresPort}/schemasync`;
        const pythonDatabaseUrl = `postgresql+psycopg://postgres:postgres@127.0.0.1:${postgresPort}/schemasync`;
        const prismaConfigDir = await mkdtemp(path.join(process.cwd(), ".tmp-prisma-config-"));

        try {
          run("docker", [
            "run",
            "--rm",
            "-d",
            "--name",
            containerName,
            "-e",
            "POSTGRES_PASSWORD=postgres",
            "-e",
            "POSTGRES_USER=postgres",
            "-e",
            "POSTGRES_DB=schemasync",
            "-p",
            `127.0.0.1:${postgresPort}:5432`,
            "postgres:16-alpine"
          ]);

          waitForContainer(containerName, ["pg_isready", "-U", "postgres", "-d", "schemasync"]);
          await symlink(path.join(process.cwd(), "node_modules"), path.join(tmpDir, "node_modules"), "dir");
          const schemaPath = await writeWorkspaceSchema(tmpDir, postgresQueryParitySchema);
          const prismaConfigPath = path.join(prismaConfigDir, "prisma.config.ts");
          await writeFile(
            prismaConfigPath,
            `import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: ${JSON.stringify(schemaPath)},
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
`,
            "utf8"
          );
          run("npx", ["prisma", "generate", "--schema", schemaPath], {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DATABASE_URL: prismaDatabaseUrl
            }
          });
          run("npx", ["prisma", "db", "push", "--config", prismaConfigPath, "--accept-data-loss"], {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DATABASE_URL: prismaDatabaseUrl
            }
          });

          const pythonPath = await createPythonEnv(tmpDir, "3.12", ["sqlmodel", "psycopg[binary]"]);
          const prismaClientUrl = pathToFileURL(path.join(tmpDir, "generated", "prisma", "client.ts")).href;
          const generatedSqlmodelDir = path.join(tmpDir, "generated", "sqlmodel");

          const prismaResult = await runTsxScript(
            `
import { PrismaPg } from "@prisma/adapter-pg";

const { PrismaClient } = await import(${JSON.stringify(prismaClientUrl)});

const prisma = new PrismaClient({
  adapter: new PrismaPg(process.env.DATABASE_URL!)
});

function normalizeUsers(users: any[]) {
  return users.map((user) => ({
    email: user.email,
    manager: user.manager ? { email: user.manager.email } : null,
    profile: user.profile
      ? { displayName: user.profile.displayName, timezone: user.profile.timezone }
      : null,
    memberships: user.memberships.map((membership: any) => ({
      role: membership.role,
      team: { slug: membership.team.slug }
    })),
    assignedTasks: user.assignedTasks.map((task: any) => ({
      title: task.title,
      state: task.state,
      priority: task.priority,
      estimateHours: task.estimateHours === null ? null : task.estimateHours.toString(),
      reporter: { email: task.reporter.email },
      project: { code: task.project.code, team: { slug: task.project.team.slug } },
      comments: task.comments.map((comment: any) => ({
        body: comment.body,
        author: { email: comment.author.email }
      }))
    })),
    counts: {
      assignedTasks: user._count.assignedTasks,
      comments: user._count.comments
    }
  }));
}

async function seed() {
  const alice = await prisma.user.create({
    data: {
      email: "alice@example.com",
      status: "ACTIVE",
      createdAt: new Date("2024-01-01T09:00:00Z"),
      profile: {
        create: {
          displayName: "Alice",
          timezone: "UTC"
        }
      }
    }
  });

  const bob = await prisma.user.create({
    data: {
      email: "bob@example.com",
      status: "ACTIVE",
      manager: { connect: { id: alice.id } },
      createdAt: new Date("2024-01-01T09:05:00Z"),
      profile: {
        create: {
          displayName: "Bob",
          timezone: "Europe/London"
        }
      }
    }
  });

  const cara = await prisma.user.create({
    data: {
      email: "cara@example.com",
      status: "INACTIVE",
      manager: { connect: { id: alice.id } },
      createdAt: new Date("2024-01-01T09:10:00Z"),
      profile: {
        create: {
          displayName: "Cara",
          timezone: "America/New_York"
        }
      }
    }
  });

  const dan = await prisma.user.create({
    data: {
      email: "dan@example.com",
      status: "ACTIVE",
      manager: { connect: { id: bob.id } },
      createdAt: new Date("2024-01-01T09:15:00Z"),
      profile: {
        create: {
          displayName: "Dan",
          timezone: "Asia/Tokyo"
        }
      }
    }
  });

  const alpha = await prisma.team.create({ data: { slug: "alpha" } });
  const beta = await prisma.team.create({ data: { slug: "beta" } });
  const gamma = await prisma.team.create({ data: { slug: "gamma" } });

  await prisma.membership.createMany({
    data: [
      { userId: alice.id, teamId: alpha.id, role: "OWNER", joinedAt: new Date("2024-01-02T09:00:00Z") },
      { userId: alice.id, teamId: beta.id, role: "MEMBER", joinedAt: new Date("2024-01-02T09:15:00Z") },
      { userId: bob.id, teamId: alpha.id, role: "MEMBER", joinedAt: new Date("2024-01-02T09:30:00Z") },
      { userId: cara.id, teamId: beta.id, role: "OWNER", joinedAt: new Date("2024-01-02T09:45:00Z") },
      { userId: dan.id, teamId: gamma.id, role: "OWNER", joinedAt: new Date("2024-01-02T10:00:00Z") }
    ]
  });

  const alphaApi = await prisma.project.create({
    data: { teamId: alpha.id, code: "alpha-api", archived: false }
  });
  const alphaOps = await prisma.project.create({
    data: { teamId: alpha.id, code: "alpha-ops", archived: true }
  });
  const betaApp = await prisma.project.create({
    data: { teamId: beta.id, code: "beta-app", archived: false }
  });
  const gammaInternal = await prisma.project.create({
    data: { teamId: gamma.id, code: "gamma-internal", archived: false }
  });

  const task1 = await prisma.task.create({
    data: {
      projectId: alphaApi.id,
      assigneeId: bob.id,
      reporterId: alice.id,
      title: "Implement auth",
      state: "IN_PROGRESS",
      priority: 5,
      estimateHours: "12.50"
    }
  });

  const task2 = await prisma.task.create({
    data: {
      projectId: alphaApi.id,
      assigneeId: alice.id,
      reporterId: bob.id,
      title: "Write docs",
      state: "TODO",
      priority: 4,
      estimateHours: "8.00"
    }
  });

  const task3 = await prisma.task.create({
    data: {
      projectId: betaApp.id,
      assigneeId: bob.id,
      reporterId: alice.id,
      title: "Polish UI",
      state: "DONE",
      priority: 9,
      estimateHours: "3.00"
    }
  });

  const task4 = await prisma.task.create({
    data: {
      projectId: betaApp.id,
      assigneeId: alice.id,
      reporterId: dan.id,
      title: "Ship dashboard",
      state: "IN_PROGRESS",
      priority: 3,
      estimateHours: "5.50"
    }
  });

  await prisma.task.create({
    data: {
      projectId: gammaInternal.id,
      assigneeId: dan.id,
      reporterId: dan.id,
      title: "Internal audit",
      state: "TODO",
      priority: 10,
      estimateHours: "2.00"
    }
  });

  await prisma.task.create({
    data: {
      projectId: alphaOps.id,
      assigneeId: alice.id,
      reporterId: bob.id,
      title: "Archive legacy stack",
      state: "TODO",
      priority: 7,
      estimateHours: "4.00"
    }
  });

  await prisma.comment.createMany({
    data: [
      {
        taskId: task1.id,
        authorId: alice.id,
        body: "Investigating API auth",
        flagged: false,
        createdAt: new Date("2024-01-03T10:00:00Z")
      },
      {
        taskId: task1.id,
        authorId: cara.id,
        body: "Noise",
        flagged: true,
        createdAt: new Date("2024-01-03T10:05:00Z")
      },
      {
        taskId: task2.id,
        authorId: bob.id,
        body: "Need product copy",
        flagged: false,
        createdAt: new Date("2024-01-03T10:10:00Z")
      },
      {
        taskId: task4.id,
        authorId: dan.id,
        body: "Waiting on design",
        flagged: false,
        createdAt: new Date("2024-01-03T10:15:00Z")
      },
      {
        taskId: task4.id,
        authorId: alice.id,
        body: "Backend ready",
        flagged: false,
        createdAt: new Date("2024-01-03T10:20:00Z")
      }
    ]
  });

  return { alice, bob, cara, dan, alpha, beta, gamma, task1, task2, task3, task4 };
}

async function main() {
  try {
    await seed();
    const users = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        memberships: {
          some: {
            team: {
              slug: {
                in: ["alpha", "beta"]
              }
            }
          }
        },
        assignedTasks: {
          some: {
            state: { not: "DONE" },
            project: { archived: false }
          }
        }
      },
      orderBy: {
        email: "asc"
      },
      select: {
        email: true,
        manager: {
          select: { email: true }
        },
        profile: {
          select: { displayName: true, timezone: true }
        },
        memberships: {
          orderBy: {
            team: { slug: "asc" }
          },
          select: {
            role: true,
            team: {
              select: { slug: true }
            }
          }
        },
        assignedTasks: {
          where: {
            state: { not: "DONE" },
            project: { archived: false }
          },
          orderBy: [{ priority: "desc" }, { title: "asc" }],
          take: 2,
          select: {
            title: true,
            state: true,
            priority: true,
            estimateHours: true,
            reporter: {
              select: { email: true }
            },
            project: {
              select: {
                code: true,
                team: {
                  select: { slug: true }
                }
              }
            },
            comments: {
              where: { flagged: false },
              orderBy: { createdAt: "asc" },
              select: {
                body: true,
                author: {
                  select: { email: true }
                }
              }
            }
          }
        },
        _count: {
          select: {
            assignedTasks: true,
            comments: true
          }
        }
      }
    });

    console.log(JSON.stringify(normalizeUsers(users)));
  } finally {
    await prisma.$disconnect();
  }
}

await main();
            `,
            {
              DATABASE_URL: prismaDatabaseUrl
            }
          );

          const sqlmodelResult = await runPythonScript(
            tmpDir,
            pythonPath,
            `
import json
import sys
from sqlalchemy import func, select
from sqlmodel import Session, create_engine

sys.path.insert(0, ${JSON.stringify(generatedSqlmodelDir)})
import models

engine = create_engine(${JSON.stringify(pythonDatabaseUrl)})

def unwrap_entity(value):
    if hasattr(value, "_mapping"):
        first = tuple(value)
        if len(first) == 1:
            return first[0]
    return value

def normalize_decimal(value):
    text = format(value.normalize(), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"

with Session(engine) as session:
    users = [
        unwrap_entity(row)
        for row in session.exec(
        select(models.User)
        .join(models.Membership, models.Membership.userId == models.User.id)
        .join(models.Team, models.Team.id == models.Membership.teamId)
        .join(models.Task, models.Task.assigneeId == models.User.id)
        .join(models.Project, models.Project.id == models.Task.projectId)
        .where(
            models.User.status == models.UserStatus.ACTIVE,
            models.Team.slug.in_(["alpha", "beta"]),
            models.Task.state != models.TaskState.DONE,
            models.Project.archived.is_(False),
        )
        .distinct()
        .order_by(models.User.email.asc())
    ).all()
    ]

    payload = []
    for user in users:
        manager_email = None
        if user.managerId is not None:
            manager_email = unwrap_entity(
                session.exec(
                    select(models.User.email).where(models.User.id == user.managerId)
                ).one()
            )

        profile_result = session.exec(
            select(models.Profile).where(models.Profile.userId == user.id)
        ).one_or_none()
        profile = None if profile_result is None else unwrap_entity(profile_result)

        memberships = []
        for role, team_slug in session.exec(
            select(models.Membership.role, models.Team.slug)
            .join(models.Team, models.Team.id == models.Membership.teamId)
            .where(models.Membership.userId == user.id)
            .order_by(models.Team.slug.asc(), models.Membership.teamId.asc())
        ).all():
            memberships.append(
                {
                    "role": role.value,
                    "team": {"slug": team_slug},
                }
            )

        assigned_tasks = []
        tasks = [
            unwrap_entity(row)
            for row in session.exec(
            select(models.Task)
            .join(models.Project, models.Project.id == models.Task.projectId)
            .where(
                models.Task.assigneeId == user.id,
                models.Task.state != models.TaskState.DONE,
                models.Project.archived.is_(False),
            )
            .order_by(models.Task.priority.desc(), models.Task.title.asc(), models.Task.id.asc())
            .limit(2)
        ).all()
        ]

        for task in tasks:
            reporter_email = unwrap_entity(
                session.exec(
                    select(models.User.email).where(models.User.id == task.reporterId)
                ).one()
            )
            project_code, team_slug = session.exec(
                select(models.Project.code, models.Team.slug)
                .join(models.Team, models.Team.id == models.Project.teamId)
                .where(models.Project.id == task.projectId)
            ).one()

            comments = []
            for body, author_email in session.exec(
                select(models.Comment.body, models.User.email)
                .join(models.User, models.User.id == models.Comment.authorId)
                .where(
                    models.Comment.taskId == task.id,
                    models.Comment.flagged.is_(False),
                )
                .order_by(models.Comment.createdAt.asc(), models.Comment.id.asc())
            ).all():
                comments.append(
                    {
                        "body": body,
                        "author": {"email": author_email},
                    }
                )

            assigned_tasks.append(
                {
                    "title": task.title,
                    "state": task.state.value,
                    "priority": task.priority,
                    "estimateHours": None if task.estimateHours is None else normalize_decimal(task.estimateHours),
                    "reporter": {"email": reporter_email},
                    "project": {"code": project_code, "team": {"slug": team_slug}},
                    "comments": comments,
                }
            )

        assigned_task_count = int(
            unwrap_entity(
                session.exec(
                    select(func.count(models.Task.id)).where(models.Task.assigneeId == user.id)
                ).one()
            )
        )
        comment_count = int(
            unwrap_entity(
                session.exec(
                    select(func.count(models.Comment.id)).where(models.Comment.authorId == user.id)
                ).one()
            )
        )

        payload.append(
            {
                "email": user.email,
                "manager": None if manager_email is None else {"email": manager_email},
                "profile": None
                if profile is None
                else {"displayName": profile.displayName, "timezone": profile.timezone},
                "memberships": memberships,
                "assignedTasks": assigned_tasks,
                "counts": {
                    "assignedTasks": assigned_task_count,
                    "comments": comment_count,
                },
            }
        )

    print(json.dumps(payload))
            `,
            {
              PY_DATABASE_URL: pythonDatabaseUrl
            }
          );

          expect(JSON.parse(sqlmodelResult)).toEqual(JSON.parse(prismaResult));
        } finally {
          await rm(prismaConfigDir, { recursive: true, force: true });
          safeRemoveContainer(containerName);
        }
      });
    },
    300_000
  );
});

async function generateIntoWorkspace(tmpDir: string, schemaTemplate: string): Promise<string> {
  const schemaPath = await writeWorkspaceSchema(tmpDir, schemaTemplate);
  run("npx", ["prisma", "generate", "--schema", schemaPath], { cwd: process.cwd() });
  return path.join(tmpDir, "generated", "sqlmodel");
}

async function writeWorkspaceSchema(tmpDir: string, schemaTemplate: string): Promise<string> {
  const schemaPath = path.join(tmpDir, "schema.prisma");
  const generatorPath = path.resolve(process.cwd(), "dist/generator.js").replace(/\\/g, "/");
  await writeFile(schemaPath, schemaTemplate.replace("__GENERATOR_PATH__", generatorPath), "utf8");
  return schemaPath;
}

async function createPythonEnv(
  tmpDir: string,
  pythonVersion: string,
  packages: string[]
): Promise<string> {
  const safeVersion = pythonVersion.replace(/\./g, "");
  const venvPath = path.join(tmpDir, `.venv-${safeVersion}`);
  const pythonPath = path.join(venvPath, "bin", "python");
  run("uv", ["venv", venvPath, "--python", pythonVersion]);
  run("uv", ["pip", "install", "--python", pythonPath, ...packages]);
  return pythonPath;
}

async function withTempWorkspace(fn: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "prisma-sqlmodel-integration-"));
  try {
    await fn(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function runTsxScript(source: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const scriptDir = await mkdtemp(path.join(process.cwd(), ".tmp-tsx-script-"));
  const scriptPath = path.join(scriptDir, "script.ts");

  try {
    await writeFile(scriptPath, source, "utf8");
    return run(path.join(process.cwd(), "node_modules", ".bin", "tsx"), [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      }
    });
  } finally {
    await rm(scriptDir, { recursive: true, force: true });
  }
}

async function runPythonScript(
  tmpDir: string,
  pythonPath: string,
  source: string,
  env?: NodeJS.ProcessEnv
): Promise<string> {
  const scriptPath = path.join(tmpDir, `script-${randomUUID()}.py`);
  await writeFile(scriptPath, source, "utf8");
  return run(pythonPath, [scriptPath], {
    env: {
      ...process.env,
      ...env
    }
  });
}

function commandAvailable(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): string {
  return execFileSync(command, args, {
    cwd: options?.cwd,
    env: options?.env,
    encoding: "utf8",
    stdio: "pipe"
  }).trim();
}

function waitForContainer(containerName: string, readinessCommand: string[]): void {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      run("docker", ["exec", containerName, ...readinessCommand]);
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }

  throw new Error(`Container '${containerName}' did not become ready in time.`);
}

function safeRemoveContainer(containerName: string): void {
  try {
    run("docker", ["rm", "-f", containerName]);
  } catch {
    // Container may already be gone.
  }
}

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a free port.")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}
