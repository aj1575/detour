import { ConvexClientProvider } from "./ConvexClientProvider";
import { TripApp } from "@/components/TripApp";

export default function Home() {
  return (
    <ConvexClientProvider>
      <TripApp />
    </ConvexClientProvider>
  );
}
