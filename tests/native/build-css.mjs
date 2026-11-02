import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), input = path.join(root, 'src/styles.css');
const css = fs.readFileSync(input, 'utf8');
const compiler = await compile(css, { base: path.dirname(input), onDependency() {} });
const scanner = new Scanner({ sources: [{ base: path.join(root, 'src'), pattern: '**/*', negated: false }] });
const out = compiler.build(scanner.scan());
fs.writeFileSync(process.argv[2], out); console.log(out.length);
