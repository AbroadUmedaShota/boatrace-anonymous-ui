import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import {readFile, writeFile} from 'node:fs/promises';
const schemaURL = new URL('../../packages/contracts/evaluation-transfer.schema.json', import.meta.url);
const targetURL = new URL('../../packages/contracts/src/generated-transfer-validator.js', import.meta.url);
const responsesURL = new URL('../../packages/contracts/evaluation-responses.schema.json', import.meta.url);
const responseTargetURL = new URL('../../packages/contracts/src/generated-response-validators.js', import.meta.url);
const cloudSchemaURL = new URL('../../packages/cloud-export/cloud-view.schema.json', import.meta.url);
const cloudTargetURL = new URL('../../packages/contracts/src/generated-cloud-validator.js', import.meta.url);
function portable(source) {
  const result = source.replaceAll('require("ajv/dist/runtime/ucs2length").default', '(value => Array.from(value).length)');
  if (/\brequire\(/.test(result)) throw new Error('UNSUPPORTED_STANDALONE_RUNTIME_HELPER');
  return result;
}
export async function writeChanged(target, code) {
  let existing;
  try { existing = await readFile(target, 'utf8'); } catch {}
  // Preserve checkout bytes when Git only changed line endings. Builds must not
  // rewrite unchanged source files during an exact-byte backup verification.
  if (existing?.replaceAll('\r\n', '\n') === code.replaceAll('\r\n', '\n')) return false;
  await writeFile(target, code, 'utf8');
  return true;
}
export async function generateContract() {
  const schema = JSON.parse(await readFile(schemaURL, 'utf8'));
  const ajv = new Ajv({allErrors: true, strict: true, code: {source: true, esm: true}});
  const savedSchema = JSON.parse(await readFile(new URL('../../packages/contracts/saved-race.schema.json', import.meta.url), 'utf8'));
  const savedAjv = new Ajv({allErrors: true, strict: true, code: {source: true, esm: true}});
  await writeChanged(new URL('../../packages/contracts/src/generated-saved-race-validator.js', import.meta.url),
    '// Generated from saved-race.schema.json; npm run cf:contracts.\n' + portable(standaloneCode(savedAjv, savedAjv.compile(savedSchema))));
  // Ajv's standalone ESM still emits a CommonJS Unicode-length helper. Inline
  // its code-point count so the identical validator runs in browsers/Workers
  // without require(), eval(), or an unsafe-eval binding.
  const standalone = portable(standaloneCode(ajv, ajv.compile(schema)));
  const code = '// Generated from evaluation-transfer.schema.json; npm run cf:contracts.\n' + standalone;
  await writeChanged(targetURL, code);
  const cloudSchema = JSON.parse(await readFile(cloudSchemaURL, 'utf8'));
  const cloudCode = portable(standaloneCode(ajv, ajv.compile(cloudSchema)));
  await writeChanged(cloudTargetURL,
    '// Generated from packages/cloud-export/cloud-view.schema.json; npm run cf:contracts.\n' + cloudCode);
  const responses = JSON.parse(await readFile(responsesURL, 'utf8'));
  ajv.addSchema(responses);
  const responseCode = portable(standaloneCode(ajv, {
    list: responses.$id + '#/$defs/list', detail: responses.$id + '#/$defs/detail', session: responses.$id + '#/$defs/session',
  }));
  await writeChanged(responseTargetURL,
    '// Generated from evaluation-responses.schema.json; npm run cf:contracts.\n' + responseCode);
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1].replaceAll('\\', '/')).href) await generateContract();
