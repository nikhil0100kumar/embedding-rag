import { promises as fs } from "node:fs";
import path from "node:path";
import { getDataDir, ingestFilePaths } from "./ingestion-core.js";

async function main() {
  const dataDir = getDataDir();
  const dirEntries = await fs.readdir(dataDir, { withFileTypes: true });
  const files = dirEntries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dataDir, entry.name));

  if (files.length === 0) {
    console.log(`No files found in ${dataDir}`);
    return;
  }

  console.log(`Found ${files.length} files in ${dataDir}`);
  const report = await ingestFilePaths(files, (progress) => {
    if (progress.type === "file_start") {
      console.log(`[Ingest CLI] [${progress.index + 1}/${progress.total}] Starting: ${progress.file}`);
    }
  });

  for (const item of report.files) {
    const details = item.error ? `: ${item.error}` : item.vectors ? ` (${item.vectors} vectors)` : "";
    console.log(`${item.status.toUpperCase()} ${item.file}${details}`);
  }

  const reportPath = path.join(process.cwd(), "ingestion-report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`\nIngestion complete. Upserted ${report.vectorsUpserted} vectors.`);
  console.log(`Report written to ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
