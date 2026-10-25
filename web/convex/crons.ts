import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("forget shared locations after six hours", { minutes: 30 }, internal.trips.forgetOldLocations);

export default crons;
