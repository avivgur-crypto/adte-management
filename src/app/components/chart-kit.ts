/**
 * Single import surface for recharts.
 *
 * Every chart component must import recharts primitives from HERE, never from
 * "recharts" directly. With three separate lazy boundaries (RevenueGoalChart,
 * DailyMovementChart) each importing recharts on its own,
 * the bundler duplicated the entire ~310 kB library into three async chunks.
 * Funneling all usage through one module lets it land in one shared chunk.
 */
export {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
