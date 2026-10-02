// Which Finance profile is active after "Seed Demo Data".
//
// The seed puts its transactions in a demo profile. It used to keep whatever
// profile was active, which on a fresh install is the auto-created, empty
// default: Finance then showed CA$0.00 everywhere and the demo data was
// invisible. The user's own profile is still kept whenever it holds anything
// of theirs; only an empty one gives way to the demo profile.

export function activeProfileAfterDemoSeed(input: {
  currentActiveId: string;
  keptProfileIds: readonly string[];
  demoProfileId: string;
  /** Profiles that hold at least one non-demo transaction or recurring expense. */
  profilesWithUserData: ReadonlySet<string>;
}): string {
  const { currentActiveId, keptProfileIds, demoProfileId, profilesWithUserData } = input;
  if (keptProfileIds.includes(currentActiveId) && profilesWithUserData.has(currentActiveId)) return currentActiveId;
  return demoProfileId;
}
