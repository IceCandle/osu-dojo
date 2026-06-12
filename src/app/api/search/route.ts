import { searchDanCatalog } from "@/db/queries";
import { emptySearchResults, isValidQuery } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";

  if (!isValidQuery(query)) {
    return Response.json(emptySearchResults());
  }

  return Response.json(await searchDanCatalog(query));
}
