import { readFileSync } from "node:fs";

const requirements = {
  "AGENTS.md": ["AI_PROTOCOL:REQUIRED", "docs/AI_COLLABORATION_PROTOCOL.md", "Tony's working principles"],
  "CLAUDE.md": ["AI_PROTOCOL:REQUIRED", "AGENTS.md", "docs/AI_COLLABORATION_PROTOCOL.md"],
  "docs/AI_COLLABORATION_PROTOCOL.md": [
    "AI_PROTOCOL:CANONICAL",
    "Canonical repository",
    "Mandatory preflight",
    "Cross-agent coordination",
    "Unshared state rules",
    "Completion gate",
    "Tony's working principles",
  ],
  "docs/AI_CHANGELOG.md": ["Shared AI Change Log"],
};

const errors = [];

for (const [file, markers] of Object.entries(requirements)) {
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    errors.push(`${file}: missing`);
    continue;
  }

  for (const marker of markers) {
    if (!contents.includes(marker)) errors.push(`${file}: missing marker ${JSON.stringify(marker)}`);
  }
}

if (errors.length > 0) {
  console.error("AI collaboration protocol guard failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("AI collaboration protocol guard passed.");
