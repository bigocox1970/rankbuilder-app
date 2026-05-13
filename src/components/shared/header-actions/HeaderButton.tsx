import type { LucideIcon } from 'lucide-react';

interface HeaderButtonProps {
	icon: LucideIcon;
	label?: string;
	onClick: () => void;
	title?: string;
	iconOnly?: boolean;
}

export function HeaderButton({
	icon: Icon,
	label,
	onClick,
	title,
	iconOnly = false,
}: HeaderButtonProps) {
	if (iconOnly) {
		return (
			<button
				className="p-1.5 rounded-md transition-all duration-200 ease-in-out hover:bg-bg-4 border border-transparent hover:border-border-primary hover:shadow-sm"
				onClick={onClick}
				title={title}
				type="button"
			>
				<Icon className="size-4 text-text-primary/50 hover:text-accent transition-colors duration-200" />
			</button>
		);
	}

	return (
		<button
			className="group relative flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-all duration-200 ease-in-out hover:bg-bg-4 border border-transparent hover:border-border-primary hover:shadow-sm overflow-hidden"
			onClick={onClick}
			title={title}
			type="button"
		>
			<Icon className="size-4 text-text-primary/50 group-hover:text-accent transition-colors duration-200 flex-shrink-0" />
			{label && (
				<span className="max-w-0 group-hover:max-w-xs overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out text-xs text-text-primary/60 group-hover:text-text-primary">
					{label}
				</span>
			)}
		</button>
	);
}
