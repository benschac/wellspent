import { spawn } from "node:child_process";
import { watch } from "chokidar";
import { appRoot, prepare, watchPaths } from "./prepare.mjs";

const referencedPaths = await prepare();
const next = spawn(
  "next",
  ["dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3002"],
  { cwd: appRoot, stdio: "inherit" },
);
let queue = Promise.resolve();
let timer;
const watcher = watch([...watchPaths, ...referencedPaths], {
  ignoreInitial: true,
  ignored: /(?:node_modules|\.git|\.source|\.next|\.content)/,
});
watcher.on("all", () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    queue = queue
      .then(prepare)
      .then((paths) => {
        watcher.add(paths);
      })
      .catch(console.error);
  }, 150);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => next.kill(signal));
next.on("exit", async (code) => {
  await watcher.close();
  process.exit(code ?? 0);
});
