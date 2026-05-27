const EVIDENCE_BLOCK_PATTERN = /```(?:json|evidence)?\s*(\{[\s\S]*?\})\s*```/gi;

export function findAllEvidenceBlocks(text) {
  const out = [];
  if (!text) return out;
  const re = new RegExp(EVIDENCE_BLOCK_PATTERN);
  let m;
  while ((m = re.exec(text)) !== null) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // ignore non-json fences
    }
  }
  return out;
}

export function findLastEvidenceBlock(text) {
  const all = findAllEvidenceBlocks(text);
  return all.length ? all[all.length - 1] : null;
}

export function evidencePasses(evidenceBlocks) {
  if (!evidenceBlocks.length) return false;
  const last = evidenceBlocks[evidenceBlocks.length - 1];
  if (last == null || typeof last !== "object") return false;
  if (!("command" in last) || !("exit_code" in last)) return false;
  return Number(last.exit_code) === 0;
}

export { EVIDENCE_BLOCK_PATTERN };
