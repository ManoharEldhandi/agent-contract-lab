import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import MiniSearch from 'minisearch';

const nodeRequire = createRequire(__filename);

export interface KnowledgeDocument {
	readonly source: string;
	readonly title: string;
	readonly content: string;
	readonly origin: 'attached-policy' | 'user-supplied';
}

export interface KnowledgeCitation {
	readonly id: string;
	readonly source: string;
	readonly title: string;
	readonly excerpt: string;
	readonly contentSha256: string;
	readonly origin: string;
}

export interface KnowledgeResult {
	readonly answer: string;
	readonly citations: readonly KnowledgeCitation[];
	readonly retrieval: {
		readonly engine: 'sqlite-fts5' | 'minisearch';
		readonly indexedChunks: number;
		readonly durationMs: number;
	};
}

interface KnowledgeBackend {
	readonly engine: KnowledgeResult['retrieval']['engine'];
	search(terms: readonly string[], limit: number): readonly KnowledgeCitation[];
	close(): void;
}

function portableBackend(
	chunks: readonly KnowledgeCitation[],
): KnowledgeBackend {
	const index = new MiniSearch({ fields: ['title', 'excerpt'] });
	const lookup = new Map(chunks.map((chunk) => [chunk.id, chunk]));
	index.addAll([...chunks]);
	return {
		engine: 'minisearch',
		search: (terms, limit) =>
			index
				.search(terms.join(' '), { combineWith: 'OR' })
				.sort(
					(left, right) =>
						right.score - left.score ||
						String(left.id).localeCompare(String(right.id)),
				)
				.slice(0, limit)
				.map((result) => lookup.get(String(result.id))!),
		close: () => {
			index.removeAll();
			lookup.clear();
		},
	};
}

function sqliteBackend(
	chunks: readonly KnowledgeCitation[],
): KnowledgeBackend | undefined {
	let database: import('node:sqlite').DatabaseSync | undefined;
	try {
		const native = nodeRequire('node:sqlite') as typeof import('node:sqlite');
		database = new native.DatabaseSync(':memory:');
		database.exec(
			'CREATE VIRTUAL TABLE chunks USING fts5(id UNINDEXED, source UNINDEXED, title, content, contentSha256 UNINDEXED, origin UNINDEXED, tokenize = "porter unicode61")',
		);
		const insert = database.prepare(
			'INSERT INTO chunks(id, source, title, content, contentSha256, origin) VALUES (?, ?, ?, ?, ?, ?)',
		);
		for (const chunk of chunks) {
			insert.run(
				chunk.id,
				chunk.source,
				chunk.title,
				chunk.excerpt,
				chunk.contentSha256,
				chunk.origin,
			);
		}
		const connection = database;
		return {
			engine: 'sqlite-fts5',
			search: (terms, limit) =>
				connection
					.prepare(
						'SELECT id, source, title, content AS excerpt, contentSha256, origin FROM chunks WHERE chunks MATCH ? ORDER BY bm25(chunks), id LIMIT ?',
					)
					.all(terms.map((term) => `"${term}"`).join(' OR '), limit)
					.map((row) =>
						Object.freeze({
							id: String(row.id),
							source: String(row.source),
							title: String(row.title),
							excerpt: String(row.excerpt),
							contentSha256: String(row.contentSha256),
							origin: String(row.origin),
						}),
					),
			close: () => connection.close(),
		};
	} catch (error) {
		database?.close();
		const code = (error as NodeJS.ErrnoException).code;
		if (
			code === 'ERR_UNKNOWN_BUILTIN_MODULE' ||
			code === 'MODULE_NOT_FOUND' ||
			(error instanceof Error && error.message.includes('no such module: fts5'))
		) {
			return undefined;
		}
		throw error;
	}
}

function knowledgeChunks(
	documents: readonly KnowledgeDocument[],
): readonly KnowledgeCitation[] {
	const chunks = new Map<string, KnowledgeCitation>();
	for (const document of documents) {
		for (let offset = 0; offset < document.content.length; offset += 1_360) {
			const excerpt = document.content.slice(offset, offset + 1_500);
			const contentSha256 = createHash('sha256').update(excerpt).digest('hex');
			const id = createHash('sha256')
				.update(`${document.source}\0${offset}\0${contentSha256}`)
				.digest('hex')
				.slice(0, 20);
			chunks.set(
				id,
				Object.freeze({
					id,
					source: document.source,
					title: document.title,
					excerpt,
					contentSha256,
					origin: document.origin,
				}),
			);
		}
	}
	return Object.freeze([...chunks.values()]);
}

export class LocalKnowledgeIndex {
	private readonly backend: KnowledgeBackend;
	private readonly chunks: number;
	private closed = false;

	constructor(
		documents: readonly KnowledgeDocument[],
		options: { readonly backend?: 'auto' | 'portable' } = {},
	) {
		if (
			documents.length > 32 ||
			documents.some(
				(document) =>
					document.content.length > 16_384 ||
					document.title.length > 256 ||
					document.source.length > 256,
			)
		) {
			throw new Error('knowledge index accepts at most 32 bounded documents');
		}
		const chunks = knowledgeChunks(documents);
		this.chunks = chunks.length;
		this.backend =
			options.backend === 'portable'
				? portableBackend(chunks)
				: (sqliteBackend(chunks) ?? portableBackend(chunks));
	}

	search(query: string, limit = 5): KnowledgeResult {
		if (this.closed) {
			throw new Error('knowledge index is closed');
		}
		if (
			query.length > 512 ||
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > 8
		) {
			throw new Error('knowledge query or result limit exceeds bounds');
		}
		const started = performance.now();
		const terms = [
			...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{2,64}/gu) ?? []),
		].slice(0, 24);
		const citations = Object.freeze(
			terms.length === 0 ? [] : [...this.backend.search(terms, limit)],
		);
		return Object.freeze({
			answer:
				citations.length === 0
					? 'No indexed guidance matched this question.'
					: citations
							.map(
								(citation, index) =>
									`[${index + 1}] ${citation.title}\n${citation.excerpt}`,
							)
							.join('\n\n'),
			citations,
			retrieval: Object.freeze({
				engine: this.backend.engine,
				indexedChunks: this.chunks,
				durationMs: Math.round((performance.now() - started) * 100) / 100,
			}),
		});
	}

	close(): void {
		if (!this.closed) {
			this.closed = true;
			this.backend.close();
		}
	}
}
