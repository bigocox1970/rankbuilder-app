import React from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { APP_TYPE_LABEL, type AppType } from 'shared/constants/templates';
import type { TimePeriod, AppSortOption } from '@/api-types';

type AppTypeFilter = 'all' | AppType;

interface AppFiltersFormProps {
  // Search props
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  searchPlaceholder?: string;
  showSearchButton?: boolean;

  // Framework filter props
  filterFramework: string;
  onFrameworkChange: (framework: string) => void;

  // App-type filter props (Discover): single-select dropdown (All / Mobile / Web app / Website)
  appTypeFilter?: AppTypeFilter;
  onAppTypeChange?: (value: AppTypeFilter) => void;
  showAppTypeFilter?: boolean;

  // Visibility filter props (optional - only for user apps)
  filterVisibility?: string;
  onVisibilityChange?: (visibility: string) => void;
  showVisibility?: boolean;

  // Time period props (conditional)
  period?: TimePeriod;
  onPeriodChange?: (period: TimePeriod) => void;
  sortBy?: AppSortOption;

  // Layout props
  className?: string;
}

// Dropdown options for the app-type filter. Labels come from the shared APP_TYPE_LABEL.
const APP_TYPE_OPTIONS: { value: AppTypeFilter; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'mobile', label: APP_TYPE_LABEL.mobile },
  { value: 'webapp', label: APP_TYPE_LABEL.webapp },
  { value: 'website', label: APP_TYPE_LABEL.website },
];


export const AppFiltersForm: React.FC<AppFiltersFormProps> = ({
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder = 'Search apps...',
  showSearchButton = false,
  appTypeFilter = 'all',
  onAppTypeChange,
  showAppTypeFilter = false,
  className = ''
}) => {

  return (
    <div className={`w-full ${className}`}>
      <div className="flex gap-2 items-center">
        {showAppTypeFilter && onAppTypeChange && (
          <Select value={appTypeFilter} onValueChange={(v) => onAppTypeChange(v as AppTypeFilter)}>
            <SelectTrigger className="h-10 w-[150px] shrink-0 bg-bg-4">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APP_TYPE_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <form onSubmit={onSearchSubmit} className="flex gap-2 flex-1 min-w-0">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <Input
              type="text"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 bg-bg-4 w-full"
            />
          </div>
          {showSearchButton && (
            <Button type="submit">Search</Button>
          )}
        </form>
      </div>
    </div>
  );
};