function sample(file, note, date = "", thumbnail = file) {
  return {
    id: file, note, date,
    thumb: `/samples/${thumbnail}.webp`,
    full: `/samples/${file}.webp`,
  };
}

const demoRolls = [
  ["rain", "after the rain", "#cfad77", [
    sample("rain-1", "The street was still shining after the rain.", "2025-04-12", "rain-1-thumb"),
    sample("rain-2", "We saved the two seats by the window.", "2025-04-13", "rain-2-thumb"),
  ]],
  ["sea", "by the sea", "#b84a32", [
    sample("sea-1", "The sea wind was loud enough to hear in our sleeves.", "2025-06-21", "sea-1-thumb"),
    sample("sea-2", "The wave reached us before we thought to take our shoes off.", "2025-06-22", "sea-2-thumb"),
  ]],
  ["home", "after dark", "#555e43", [
    sample("home-1", "It was just getting dark when the train crossed the bridge.", "2025-09-05", "home-1-thumb"),
    sample("home-2", "A few lights were already on when we got home.", "2025-09-06", "home-2-thumb"),
    sample("home-3", "The diner stayed lit after the rain."),
    sample("home-4", "The cup was still warm."),
    sample("home-5", "We crossed under the last streetlamp."),
    sample("home-6", "A table for two, after dinner."),
    sample("home-7", "The light was on upstairs."),
    sample("home-8", "We left the window open."),
  ]],
];

export const demo = {
  id: "demo",
  demo: true,
  title: "Roll for us",
  letter: "Dear you,\n\nSome things were easier to put on film. The wet street, the last light by the sea, the windows already glowing on our way home.\n\nI kept a few frames from each. Pick the ones you want to see again. There’s a little more on the back.",
  rolls: demoRolls.map(([id, name, color, photos]) => ({ id, name, color, photos })),
};
