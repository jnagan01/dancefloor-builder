import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppearance } from "@/components/AppearanceProvider";
import { toast } from "sonner";
export function AppearanceSettings() {
  const { appearance, setAppearance } = useAppearance();
  return <section id="appearance" className="space-y-4 border-b border-border pb-8"><h2 className="font-display text-lg">Appearance</h2><div className="flex flex-wrap gap-2" role="group" aria-label="Appearance">{([{ value: "light", label: "Light", Icon: Sun }, { value: "dark", label: "Dark", Icon: Moon }, { value: "system", label: "System", Icon: Monitor }] as const).map(({ value, label, Icon }) => <Button key={value} variant={appearance === value ? "default" : "outline"} aria-pressed={appearance === value} onClick={() => { try { setAppearance(value); } catch { toast.error("Appearance could not be saved on this device."); } }}><Icon className="mr-2 size-4" />{label}</Button>)}</div></section>;
}