import { siteHostnameSchema } from "../../shared/site";
import { reviewFeedSearch } from "./reviewFeedSearch";

export const homeSearch = reviewFeedSearch.extend({
  taskSite: siteHostnameSchema.optional(),
});
