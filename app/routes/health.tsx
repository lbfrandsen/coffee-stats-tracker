import type { Route } from "./+types/health";
import {
  CardAction,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  APP_TIME_ZONE,
  formatDateTime,
  formatTime,
  parseUtcDateTime,
} from "~/lib/date-time";
import { getPersonDisplayColor } from "~/lib/person-colors";
import { cn } from "~/lib/utils";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "~/components/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Health | Kaffemændene" },
    {
      name: "description",
      content: "Check the health of the caffeine addicts",
    },
  ];
}

export default function Health() {
  return null;
}
