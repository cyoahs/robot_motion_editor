export function findIKLinkByName(ikRoot, linkName) {
  let found = null;
  ikRoot?.traverse((c) => {
    if (c.isLink && (c.name === linkName || c.urdfName === linkName)) {
      found = c;
    }
  });
  return found;
}
