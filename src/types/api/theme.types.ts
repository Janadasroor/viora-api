export interface Theme {
  id: number;
  name: string;

  primaryColor: string;
  primaryVariantColor?: string;
  secondaryColor: string;
  secondaryVariantColor?: string;
  backgroundColor: string;
  surfaceColor: string;
  errorColor: string;
  onPrimaryColor: string;
  onSecondaryColor: string;
  onBackgroundColor: string;
  onSurfaceColor: string;
  onErrorColor: string;

  fontFamily?: string;

  headlineLargeSize?: number;
  headlineMediumSize?: number;
  headlineSmallSize?: number;
  bodyLargeSize?: number;
  bodyMediumSize?: number;
  bodySmallSize?: number;
  labelLargeSize?: number;
  labelMediumSize?: number;
  labelSmallSize?: number;

  fontWeightNormal?: number;
  fontWeightMedium?: number;
  fontWeightBold?: number;

  cornerSmall?: number;
  cornerMedium?: number;
  cornerLarge?: number;

  isDarkTheme?: boolean;
  customFontUrl?: string;
}
