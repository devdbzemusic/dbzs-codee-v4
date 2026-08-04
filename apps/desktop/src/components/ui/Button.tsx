import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean;
  children: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "border-dbzs-cyan/50 bg-dbzs-cyan/10 text-dbzs-cyan hover:bg-dbzs-cyan/20",
  secondary: "border-dbzs-border bg-dbzs-panelSoft text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-text",
  danger: "border-dbzs-red/50 bg-dbzs-red/10 text-dbzs-red hover:bg-dbzs-red/20",
  ghost: "border-dbzs-border bg-transparent text-dbzs-muted hover:border-dbzs-cyan/40 hover:text-dbzs-text"
};

const ACTIVE_CLASS = "border-dbzs-cyan/40 bg-dbzs-cyan/10 text-dbzs-cyan";

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-1 text-[10.5px]"
};

/**
 * Shared button primitive for the RuntimeChat feature. Replaces the many
 * hand-rolled `border ... px-2 py-1 text-[10px] text-dbzs-*` className
 * strings that were previously duplicated (with small, inconsistent
 * variations) across the composer, patch panel, approval cards, and header
 * toggles.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "secondary",
  size = "sm",
  active = false,
  children,
  ...rest
}, ref) {
  const variantClass = active ? ACTIVE_CLASS : VARIANT_CLASS[variant];
  return (
    <button
      className={`rounded border ${variantClass} ${SIZE_CLASS[size]} font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40`}
      ref={ref}
      type="button"
      {...rest}
    >
      {children}
    </button>
  );
});
