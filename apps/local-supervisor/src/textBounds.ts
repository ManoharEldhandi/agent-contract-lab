export function boundedUtf8(text: string, maximumBytes: number): string {
	const bytes = Buffer.from(text);
	return bytes.length <= maximumBytes
		? text
		: new TextDecoder().decode(bytes.subarray(0, maximumBytes), {
				stream: true,
			});
}
