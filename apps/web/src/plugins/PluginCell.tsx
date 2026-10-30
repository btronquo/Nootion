import { Component, type ReactNode } from "react";
import { t, type DatabaseProperty } from "@nootion/shared";
import { propertyCell } from "./registry";

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The plugin's component for a cell of its column type; null when the plugin is off (the cell is then a plain text). */
export function pluginCell(
  prop: DatabaseProperty,
  props: { value: unknown; editable: boolean; variant: "table" | "panel"; onChange: (value: string | null) => void },
): ReactNode | null {
  const spec = prop.config.plugin;
  const Cell = spec ? propertyCell(spec.id, spec.type) : undefined;
  if (!Cell) return null;
  const value = typeof props.value === "string" && props.value !== "" ? props.value : null;
  return (
    <div className={`flex h-full min-h-[34px] items-center ${props.variant === "panel" ? "py-1" : "px-2"}`} data-plugin-cell={`${spec!.id}.${spec!.type}`}>
      <Boundary
        fallback={
          <span className="text-xs text-red-600" title={t("plugins.cellCrashed")}>
            ⚠ {value}
          </span>
        }
      >
        <Cell value={value} setValue={props.onChange} editable={props.editable} variant={props.variant} />
      </Boundary>
    </div>
  );
}
