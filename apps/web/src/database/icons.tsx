import { ArrowUpRight, Fingerprint, Loader, Phone, UserPen, MousePointerClick, AtSign, Calendar, CheckSquare, Clock, Euro, Hash, Link, List, Paperclip, Percent, Puzzle, Sigma, SquareFunction, Tag, Text, Type, User, UserCheck } from "lucide-react";
import type { PropertyType } from "@nootion/shared";

export function PropertyIcon({ type, size = 14 }: { type: PropertyType; size?: number }) {
  const Icon = {
    title: Type,
    text: Text,
    number: Hash,
    currency: Euro,
    percent: Percent,
    date: Calendar,
    select: Tag,
    multi_select: List,
    status: Loader,
    checkbox: CheckSquare,
    url: Link,
    email: AtSign,
    phone: Phone,
    person: User,
    file: Paperclip,
    created_time: Clock,
    last_edited_time: Clock,
    created_by: UserCheck,
    last_edited_by: UserPen,
    unique_id: Fingerprint,
    relation: ArrowUpRight,
    rollup: Sigma,
    formula: SquareFunction,
    button: MousePointerClick,
    plugin: Puzzle,
  }[type];
  return <Icon size={size} className="shrink-0 text-neutral-400" />;
}
