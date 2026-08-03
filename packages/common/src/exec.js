import { execFile } from "node:child_process";

/**
 * Führt ein Kommando mit Argument-Array aus (kein Shell, daher keine
 * Injection über Argumente) und liefert stdout als String.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ maxBuffer?: number }} [opts]
 * @returns {Promise<string>}
 */
export function run(cmd, args, { maxBuffer = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr && stderr.trim()) || err.message));
        return;
      }
      resolve(stdout.toString());
    });
  });
}
