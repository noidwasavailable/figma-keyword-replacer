export type DebouncedFunction<TArgs extends unknown[]> = ((
	...args: TArgs
) => void) & {
	cancel: () => void;
	flush: () => void;
};

export function debounce<TArgs extends unknown[]>(
	fn: (...args: TArgs) => void,
	wait: number,
): DebouncedFunction<TArgs> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let lastArgs: TArgs | undefined;
	let lastThis: unknown;

	const delay = Math.max(0, Number.isFinite(wait) ? wait : 0);

	const invoke = () => {
		if (!lastArgs) return;
		const args = lastArgs;
		const context = lastThis;
		lastArgs = undefined;
		lastThis = undefined;
		fn.apply(context, args);
	};

	const debounced = function (this: unknown, ...args: TArgs) {
		lastArgs = args;
		lastThis = this;

		if (timeout !== undefined) clearTimeout(timeout);
		timeout = setTimeout(() => {
			timeout = undefined;
			invoke();
		}, delay);
	} as DebouncedFunction<TArgs>;

	debounced.cancel = () => {
		if (timeout !== undefined) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		lastArgs = undefined;
		lastThis = undefined;
	};

	debounced.flush = () => {
		if (timeout === undefined) return;
		clearTimeout(timeout);
		timeout = undefined;
		invoke();
	};

	return debounced;
}
