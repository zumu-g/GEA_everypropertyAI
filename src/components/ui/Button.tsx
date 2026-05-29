import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 " +
  "focus:outline-none focus:ring-2 focus:ring-[#C8A96E] focus:ring-offset-2 " +
  "active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-[#C8A96E] text-white hover:bg-[#B8954A]",
  secondary:
    "border border-[#E7E9EE] bg-white text-[#16181D] hover:border-[#C8A96E] hover:text-[#C8A96E]",
  ghost: "text-[#6B7077] hover:bg-[#F4F5F7] hover:text-[#16181D]",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-5 text-sm",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    />
  );
}
