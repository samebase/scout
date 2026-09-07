import { describe, expect, test, vi } from "vite-plus/test";
import { createSkillTools, bundledSkills, skillInstructions } from "./skills";
import { requireRuntimeTool } from "./lib/runtimeTool";

describe("bundled skill context", () => {
  test("discloses descriptions and injects each selected guide once", () => {
    const inactive = skillInstructions([]);
    const active = skillInstructions(["research", "games", "games"]);
    for (const skill of Object.values(bundledSkills)) {
      expect(inactive).toContain(skill.description);
      expect(inactive).not.toContain(skill.guidance);
    }
    expect(active.split(bundledSkills.games.guidance)).toHaveLength(2);
    expect(active).toContain(bundledSkills.research.guidance);
    expect(active).not.toContain(bundledSkills.email.guidance);
    expect(active.indexOf('<skill name="games">')).toBeLessThan(
      active.indexOf('<skill name="research">'),
    );
  });

  test("selects and clears guides without putting their bodies in the transcript", async () => {
    let selected: Parameters<typeof skillInstructions>[0] = [];
    const select = vi.fn(async (names: Parameters<typeof skillInstructions>[0]) => {
      selected = names;
      return [...selected];
    });
    const tools = createSkillTools(select);
    const loader = requireRuntimeTool(tools, "load_skills");
    const options = { toolCallId: "skills-1", messages: [], context: {} };
    await expect(
      loader.execute({ names: ["email", "research", "email"] }, options),
    ).resolves.toEqual({
      activeSkills: ["research", "email"],
    });
    await expect(loader.execute({ names: [] }, options)).resolves.toEqual({
      activeSkills: [],
    });
    await expect(loader.execute({ names: ["invented"] }, options)).rejects.toThrow();
    expect(select).toHaveBeenCalledTimes(2);
  });

  test("discovers the Papergames guide and retains both game guides in later instructions", async () => {
    const siteGuide = bundledSkills["papergames-tic-tac-toe"];
    const catalog = skillInstructions([]);
    expect(catalog).toContain(`papergames-tic-tac-toe: ${siteGuide.description}`);
    expect(siteGuide.description).toContain("papergames.io");
    expect(siteGuide.description).toContain("Tic Tac Toe");
    expect(siteGuide.description).toContain("alongside games");

    let selected: Parameters<typeof skillInstructions>[0] = [];
    const tools = createSkillTools(async (names) => {
      selected = names;
      return names;
    });
    const loader = requireRuntimeTool(tools, "load_skills");
    await expect(
      loader.execute(
        { names: ["papergames-tic-tac-toe", "games", "papergames-tic-tac-toe"] },
        { toolCallId: "site-guide-1", messages: [], context: {} },
      ),
    ).resolves.toEqual({ activeSkills: ["games", "papergames-tic-tac-toe"] });

    const nextStep = skillInstructions(selected);
    const followUp = skillInstructions(selected);
    expect(followUp).toBe(nextStep);
    expect(followUp.split(bundledSkills.games.guidance)).toHaveLength(2);
    expect(followUp.split(siteGuide.guidance)).toHaveLength(2);
    expect(followUp.indexOf('<skill name="games">')).toBeLessThan(
      followUp.indexOf('<skill name="papergames-tic-tac-toe">'),
    );
    expect(followUp).not.toContain(bundledSkills.research.guidance);
    expect(followUp).not.toContain(bundledSkills.email.guidance);
  });
});
