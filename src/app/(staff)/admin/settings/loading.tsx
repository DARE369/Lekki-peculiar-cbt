import { CardsPageSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <CardsPageSkeleton label="Loading settings…" cards={6} tabs={5} />;
}
