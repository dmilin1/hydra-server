import { summarizePostDetails } from "./summarizePostDetails";
import { summarizeComments } from "./summarizeComments";
import { filterPosts } from "./filterPosts";
import { createEmbedding } from "./createEmbedding";
import { askQuestion } from "./askQuestion";
import { translate } from "./translate";

export default {
  "/api/ai/summarizePostDetails": {
    POST: summarizePostDetails,
  },
  "/api/ai/summarizeComments": {
    POST: summarizeComments,
  },
  "/api/ai/translate": {
    POST: translate,
  },
  "/api/ai/filterPosts": {
    POST: filterPosts,
  },
  "/api/ai/createEmbedding": {
    POST: createEmbedding,
  },
  "/api/ai/askQuestion": {
    POST: askQuestion,
  },
};
