import { log } from './logger';

let totalCost = 0;
let totalTokensInput = 0;
let totalTokensOutput = 0;
let requestCount = 0;

// Single-line logs (no enter/exit pairs) — these functions are tiny and
// fire dozens of times per turn; pair-logging just doubles the noise.
export function addTokens(input: number, output: number, cost?: number): void {
	totalTokensInput += input;
	totalTokensOutput += output;
	if (cost) {
		totalCost += cost;
	}
	log.debug('Tokens', 'addTokens', { input, output, cost, totalTokensInput, totalTokensOutput, totalCost }, '🪙');
}

export function addRequest(): void {
	requestCount++;
	log.debug('Tokens', 'addRequest', { requestCount }, '📨');
}

export function getTotals(): { totalCost: number; totalTokensInput: number; totalTokensOutput: number; requestCount: number } {
	return { totalCost, totalTokensInput, totalTokensOutput, requestCount };
}

export function setTotals(cost: number, input: number, output: number): void {
	totalCost = cost;
	totalTokensInput = input;
	totalTokensOutput = output;
	log.debug('Tokens', 'setTotals', { totalCost, totalTokensInput, totalTokensOutput }, '🪙');
}

export function resetTotals(): void {
	totalCost = 0;
	totalTokensInput = 0;
	totalTokensOutput = 0;
	requestCount = 0;
	log.debug('Tokens', 'resetTotals', undefined, '🧹');
}
