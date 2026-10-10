export type Sport = { id: string; name: string; slug: string; emoji: string | null; icon_url?: string | null };

export type CourtRow = {
  id: string;
  name: string;
  is_indoor: boolean;
  surface_type: string | null;
  maps_url: string | null;
  facility: { name: string; city: string | null; address: string | null } | null;
  court_sports: { price_per_hour: number; sport: Sport | null }[];
  court_photos: { path: string; sort_order: number; status: string }[];
};

export type ReviewStats = { avg: number | null; count: number; played: number };
