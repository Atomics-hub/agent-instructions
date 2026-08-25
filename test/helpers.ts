import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export interface TestProject {
  root: string;
  write(path: string, content: string): Promise<string>;
  directory(path: string): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createProject(): Promise<TestProject> {
  const root = await mkdtemp(join(tmpdir(), "agent-instructions-test-"));
  await mkdir(join(root, ".git"));
  return {
    root,
    async write(path, content) {
      const absolute = join(root, path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content, "utf8");
      return absolute;
    },
    async directory(path) {
      const absolute = join(root, path);
      await mkdir(absolute, { recursive: true });
      return absolute;
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
