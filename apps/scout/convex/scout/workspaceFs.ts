"use node";

import { InMemoryFs } from "just-bash";
import {
  MAX_RUNTIME_ENTRIES,
  MAX_RUNTIME_PATH_LENGTH,
  MAX_RUNTIME_PATH_DEPTH,
} from "../workspaceModel";

// just-bash 3.4.2 caps file bodies, not directory or symlink metadata. Its public
// creation methods also cover implicit parents and recursive copy/move calls.
export class WorkspaceFs extends InMemoryFs {
  private assertDestination(path: string) {
    const normalized = this.resolvePath("/", path);
    if (normalized.length > MAX_RUNTIME_PATH_LENGTH)
      throw new Error(
        `ENAMETOOLONG: filesystem path limit is ${MAX_RUNTIME_PATH_LENGTH} characters`,
      );
    const segments = normalized.split("/").filter(Boolean);
    if (segments.length > MAX_RUNTIME_PATH_DEPTH)
      throw new Error(`ENAMETOOLONG: filesystem path depth limit is ${MAX_RUNTIME_PATH_DEPTH}`);
    const paths = new Set(this.getAllPaths());
    paths.add(normalized);
    let parent = "";
    for (const segment of segments) {
      parent += `/${segment}`;
      paths.add(parent);
    }
    if (paths.size > MAX_RUNTIME_ENTRIES)
      throw new Error(
        `ENOSPC: filesystem entry limit is ${MAX_RUNTIME_ENTRIES}, including temporary paths`,
      );
  }

  override writeFileSync(...args: Parameters<InMemoryFs["writeFileSync"]>) {
    this.assertDestination(args[0]);
    super.writeFileSync(...args);
  }

  override writeFileLazy(...args: Parameters<InMemoryFs["writeFileLazy"]>) {
    this.assertDestination(args[0]);
    super.writeFileLazy(...args);
  }

  override mkdirSync(...args: Parameters<InMemoryFs["mkdirSync"]>) {
    this.assertDestination(args[0]);
    super.mkdirSync(...args);
  }

  override async cp(...args: Parameters<InMemoryFs["cp"]>) {
    this.assertDestination(args[1]);
    return super.cp(...args);
  }

  override async mv(...args: Parameters<InMemoryFs["mv"]>) {
    this.assertDestination(args[1]);
    return super.mv(...args);
  }

  override async link(...args: Parameters<InMemoryFs["link"]>) {
    // Finish lazy-source loading before checking capacity; super.link then inserts
    // synchronously, so concurrent links cannot all reserve the same final slot.
    await this.stat(args[0]);
    this.assertDestination(args[1]);
    return super.link(...args);
  }

  override async symlink(...args: Parameters<InMemoryFs["symlink"]>) {
    if (args[0].length > MAX_RUNTIME_PATH_LENGTH)
      throw new Error(
        `ENAMETOOLONG: symlink target limit is ${MAX_RUNTIME_PATH_LENGTH} characters`,
      );
    this.assertDestination(args[1]);
    return super.symlink(...args);
  }
}
