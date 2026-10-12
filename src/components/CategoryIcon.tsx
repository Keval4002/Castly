import { Gem, Shirt, type LucideProps } from "lucide-react";
import type { Category } from "@/lib/catalog/options";

const ICONS = { shirt: Shirt, gem: Gem } as const;

export function CategoryIcon({ icon, ...props }: { icon: Category["icon"] } & LucideProps) {
  const Icon = ICONS[icon];
  return <Icon aria-hidden strokeWidth={1.75} {...props} />;
}
