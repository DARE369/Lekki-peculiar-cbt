import { ListPageSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <ListPageSkeleton label="Loading your question bank…" rows={8} />;
}
