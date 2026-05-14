import { useState, useEffect } from 'react';

function formatElapsed(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, '0')}`;
}

export function SandboxLoadingScreen() {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
		return () => clearInterval(interval);
	}, []);

	return (
		<div className="flex-1 flex flex-col items-center justify-center bg-bg-1 min-h-0">
			{/* Spinning logo */}
			<div className="relative mb-8 w-24 h-24">
				<svg
					className="absolute inset-0 w-full h-full animate-spin"
					style={{ animationDuration: '1.4s' }}
					viewBox="0 0 96 96"
				>
					<circle
						cx="48"
						cy="48"
						r="44"
						fill="none"
						stroke="#00E676"
						strokeWidth="3"
						strokeLinecap="round"
						strokeDasharray="138 138"
						strokeDashoffset="34"
					/>
				</svg>
				<div className="absolute inset-0 flex items-center justify-center">
					<img
						src="/favicon-96x96.png"
						alt="RankBuilder"
						className="w-14 h-14 object-contain"
					/>
				</div>
			</div>

			<h2 className="text-2xl font-bold tracking-tight text-text-primary mb-2">
				Loading your app
			</h2>
			<p className="text-sm text-text-tertiary mb-8">
				Your application will be ready shortly
			</p>

			<div className="flex items-center gap-2 text-xs text-text-tertiary">
				<span
					className="w-1.5 h-1.5 rounded-full animate-pulse"
					style={{ backgroundColor: '#00E676' }}
				/>
				Time elapsed: {formatElapsed(elapsed)}
			</div>
		</div>
	);
}
