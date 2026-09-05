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
    const select = vi.fn(async (names: Parameters<typeof skillInstructions>[0] | null) => {
      selected = names ?? selected;
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
    await expect(requireRuntimeTool(tools, "keep_skills").execute({}, options)).resolves.toEqual({
      activeSkills: ["research", "email"],
    });
    await expect(loader.execute({ names: [] }, options)).resolves.toEqual({
      activeSkills: [],
    });
    await expect(loader.execute({ names: ["invented"] }, options)).rejects.toThrow();
    expect(select).toHaveBeenCalledTimes(3);
  });
});
