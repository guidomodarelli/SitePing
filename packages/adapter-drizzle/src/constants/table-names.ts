/** Table names — override to fit your naming or avoid collisions. */
export interface BeezpingTableNames {
  feedbacks: string;
  annotations: string;
  comments: string;
}

export const DEFAULT_BEEZPING_TABLE_NAMES: BeezpingTableNames = {
  feedbacks: "beezping_feedbacks",
  annotations: "beezping_annotations",
  comments: "beezping_comments",
};
