/**
 * The product's icon vocabulary (ADR-0030): every glyph an application screen may use, from one
 * library, `lucide-react`, re-exported here and nowhere else.
 *
 * Why a curated list rather than importing the library directly:
 *
 * - **One style.** Lint refuses `lucide-react` (and any other icon package) outside `@alola/ui`, so
 *   a screen cannot mix icon families or reach for an emoji-shaped substitute.
 * - **One meaning per glyph.** The names below are the ones in use; before adding a new one, check
 *   whether an existing glyph already means that thing on another screen.
 * - **Tree-shaking survives.** These are named ES re-exports of a side-effect-free package, so only
 *   the glyphs actually imported reach a bundle.
 *
 * Render them through `<Icon icon={…} />`, which fixes the stroke weight, hides decorative glyphs from
 * assistive technology, and mirrors directional ones in RTL.
 */
export type { LucideIcon } from 'lucide-react';
export {
  AlarmClock,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Bell,
  BellRing,
  Briefcase,
  Building,
  Building2,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  Coins,
  Download,
  EllipsisVertical,
  Eye,
  EyeOff,
  FilePen,
  FileSignature,
  FileUp,
  FlaskConical,
  Globe,
  HandCoins,
  History,
  House,
  Image,
  ImageUp,
  Inbox,
  Info,
  KeyRound,
  Landmark,
  Languages,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Megaphone,
  Menu,
  Network,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Save,
  ScrollText,
  Search,
  SearchX,
  Settings,
  ShieldCheck,
  Target,
  TrendingUp,
  TriangleAlert,
  Unplug,
  Upload,
  UserPlus,
  Users,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react';
