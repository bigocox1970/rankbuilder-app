import { useEffect, useState } from 'react';
import { WebSocket } from 'partysocket';
import clsx from 'clsx';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { sendWebSocketMessage } from '../utils/websocket-helpers';
import {
	MODEL_PROVIDER_PRESETS,
	type ModelProvider,
} from 'shared/constants/modelProviderPresets';

const PROVIDERS: ModelProvider[] = ['deepseek', 'minimax'];

const PROVIDER_TITLES: Record<ModelProvider, string> = {
	deepseek: 'DeepSeek V4 via OpenRouter (default) — spend tracks in the AI Gateway',
	minimax: 'MiniMax M3, direct via subscription key (not through OpenRouter/the gateway)',
};

/**
 * Per-user whole-stack model switcher for the chat pane. Flipping applies the matching provider
 * preset to the user's own account and signals the live agent to reload, so the next message
 * uses the new model. Lets a tester stuck on one model try the other on the same app.
 */
export function ModelProviderToggle({ websocket }: { websocket?: WebSocket }) {
	const [provider, setProvider] = useState<ModelProvider | null>(null);
	const [switching, setSwitching] = useState(false);

	useEffect(() => {
		let active = true;
		apiClient
			.getModelProvider()
			.then((res) => {
				if (active && res.success && res.data) setProvider(res.data.provider);
			})
			.catch(() => {
				/* toggle stays hidden if we can't read the current provider */
			});
		return () => {
			active = false;
		};
	}, []);

	const handleSwitch = async (next: ModelProvider) => {
		if (switching || next === provider) return;
		const prev = provider;
		setSwitching(true);
		setProvider(next); // optimistic
		try {
			const res = await apiClient.setModelProvider(next);
			if (!res.success) throw new Error('Failed to switch model');
			if (websocket) sendWebSocketMessage(websocket, 'reload_model_configs');
			toast.success(
				`Now using ${MODEL_PROVIDER_PRESETS[next].label} — send your next message to use it`,
			);
		} catch {
			setProvider(prev);
			toast.error('Could not switch model');
		} finally {
			setSwitching(false);
		}
	};

	if (!provider) return null;

	return (
		<div className="inline-flex items-center gap-1 rounded-full border border-bg-4 bg-bg-2/50 p-0.5">
			<span className="px-1.5 text-[10px] uppercase tracking-wider text-text-tertiary select-none">
				Model
			</span>
			{PROVIDERS.map((p) => (
				<button
					key={p}
					type="button"
					disabled={switching}
					onClick={() => handleSwitch(p)}
					title={PROVIDER_TITLES[p]}
					className={clsx(
						'px-2.5 py-1 rounded-full text-xs transition-colors disabled:opacity-60',
						provider === p
							? 'bg-accent text-black font-medium'
							: 'text-text-tertiary hover:text-text-primary',
					)}
				>
					{MODEL_PROVIDER_PRESETS[p].label}
				</button>
			))}
		</div>
	);
}
