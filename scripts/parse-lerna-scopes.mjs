import * as childProcess from 'child_process';

const labels = JSON.parse(process.argv[2]);
const packageList = new Set(
	childProcess.spawnSync('lerna', ['list']).stdout
		.toString('utf8')
		.split('\n')
		.filter(Boolean)
);

console.error('Labels:', labels);
console.error('Packages:', [...packageList]);

const scopes = labels
		.filter((l) => {
			return l.startsWith('pkg:');
		})
		.map((l) => {
			return l.replace(/^pkg:/, '@opentelemetry/');
		})
		.filter((pkgName) => {
			return pkgName && packageList.has(pkgName);
		})

console.error('Scopes:', scopes);

console.log(
	scopes.map((scope) => {
		return `--scope ${scope}`;
	})
	.join(' ')
);
