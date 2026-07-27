export interface ExternalIssue {
  readonly key: string;
  readonly title: string;
  readonly status: "todo" | "working" | "done";
}

export class FakeIssueConnector {
  readonly #issues = new Map<string, ExternalIssue>();

  async upsert(issue: ExternalIssue): Promise<ExternalIssue> {
    this.#issues.set(issue.key, issue);
    return issue;
  }

  async get(key: string): Promise<ExternalIssue | undefined> {
    return this.#issues.get(key);
  }
}
