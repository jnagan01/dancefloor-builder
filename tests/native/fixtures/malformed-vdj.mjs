// Synthetic malformed VirtualDJ database.xml (no real user data). Shared by the
// unit tests, the Electron DOMParser check and the native production-path flow.
// Layout mirrors VirtualDJ: one <Song> per line, a malformed entry in the middle.
export function malformedVdjFixture(dir) {
  const p = name => `${dir}/${name}`;
  const files = {
    bill: p("Bill Withers - Ain't No Sunshine.mp3"),
    billOther: p("other/Bill Withers - Ain't No Sunshine.mp3"),
    simon: p('Simon & Garfunkel - Cecilia.mp3'),
    beyonce: p('Beyoncé - Halo ❤.mp3'),
    raw: p("Don't Raw - Quote.mp3"),
    broken: p('Broken - Entry.mp3'),
    bare: p('Tom & Jerry - Bare.mp3'),
    entity: p('Entity - &boom;.mp3'),
    unclosed: p('Unclosed - Quote.mp3'),
    zero: p('Zed - Zero.mp3'),
    bad: p('Zed - Bad.mp3'),
    after: p('Zed - After.mp3'),
  };
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE VirtualDJ_Database [<!ENTITY boom "EXPANDED"><!ENTITY xxe SYSTEM "file:///etc/passwd">]>',
    '<VirtualDJ_Database Version="2024">',
    ` <Song FilePath="${p('Bill Withers - Ain&apos;t No Sunshine.mp3')}" FileSize="4646464">`,
    '  <Tags Author="Bill Withers" Title="Ain&apos;t No Sunshine" Genre="Soul" Year="1971" />',
    '  <Infos SongLength="290.352086" PlayCount="7" />',
    '  <Scan Bpm="0.769231" Key="Am" />',
    ' </Song>',
    ` <Song FilePath="${p('other/Bill Withers - Ain&apos;t No Sunshine.mp3')}">`,
    '  <Tags Author="Bill Withers" Title="Ain&apos;t No Sunshine" />',
    '  <Infos SongLength="120" />',
    ' </Song>',
    ` <Song FilePath="${p('Simon &amp; Garfunkel - Cecilia.mp3')}">`,
    '  <Tags Author="Simon &amp; Garfunkel" Title="Cecilia" Genre="Folk" />',
    '  <Infos SongLength="174.6" PlayCount="0" />',
    ' </Song>',
    ` <Song FilePath="${p('Beyonc&#233; - Halo &#x2764;.mp3')}">`,
    '  <Tags Author="Beyonc&#xE9;" Title="Halo" />',
    '  <Infos SongLength="261" />',
    ' </Song>',
    ` <Song FilePath="${p("Don't Raw - Quote.mp3")}">`,
    `  <Tags Author="Don't Raw" Title='Say &quot;Hi&quot;' />`,
    '  <Infos SongLength="201.4" />',
    ' </Song>',
    // Malformed but recoverable: control character and raw "<" (Python: "not well-formed (invalid token)").
    ` <Song FilePath="${p('Broken - Entry.mp3')}">`,
    '  <Tags Author="Broken" Title="Entry \u0001 with <b> tag" Genre="Pop" />',
    '  <Infos SongLength="200.2" />',
    ' </Song>',
    // Legacy unescaped ampersand: the literal "&" is the file name.
    ` <Song FilePath="${p('Tom & Jerry - Bare.mp3')}">`,
    '  <Tags Author="Tom & Jerry" Title="Bare" />',
    '  <Infos SongLength="150" />',
    ' </Song>',
    // DTD entities must never be expanded.
    ` <Song FilePath="${p('Entity - &boom;.mp3')}">`,
    '  <Tags Author="Entity" Title="&boom; &xxe;" />',
    '  <Infos SongLength="100" />',
    ' </Song>',
    // Unrecoverable: the path quote never closes before the next tag.
    ` <Song FilePath="${p('Unclosed - Quote.mp3')}>`,
    '  <Tags Author="Unclosed" Title="Quote" />',
    '  <Infos SongLength="180" />',
    ' </Song>',
    // Unrecoverable: invalid numeric character reference in the path.
    ` <Song FilePath="${p('Bad &#0; Ref.mp3')}">`,
    '  <Infos SongLength="99" />',
    ' </Song>',
    ` <Song FilePath="${p('Zed - Zero.mp3')}"><Tags Author="Zed" Title="Zero" /><Infos SongLength="0" /></Song>`,
    ` <Song FilePath="${p('Zed - Bad.mp3')}"><Tags Author="Zed" Title="Bad" /><Infos SongLength="abc" /></Song>`,
    ` <Song FilePath="${p('Zed - After.mp3')}"><Tags Author="Zed" Title="After" /><Infos SongLength="305.5" /></Song>`,
    '</VirtualDJ_Database>',
  ];
  const expectedLength = {
    [files.bill]: '290', [files.billOther]: '120', [files.simon]: '175', [files.beyonce]: '261', [files.raw]: '201',
    [files.broken]: '200', [files.bare]: '150', [files.entity]: '100', [files.after]: '306',
  };
  return { xml: lines.join('\n'), files, expectedLength, skippedCount: 2 };
}
