export type Section = "Warm Up" | "Transition" | "Peak";

export interface LibrarySong {
  artist: string;
  song: string;
  genre: string;
  decade: string;
  energy: number;
  danceability: number;
  section: Section;
}

export const SONG_LIBRARY: LibrarySong[] = [
  // Warm Up — disco, funk, oldies, singalongs
  { artist: "Earth, Wind & Fire", song: "September", genre: "Disco", decade: "1970s", energy: 7, danceability: 9, section: "Warm Up" },
  { artist: "Stevie Wonder", song: "Signed, Sealed, Delivered I'm Yours", genre: "Funk", decade: "1970s", energy: 6, danceability: 8, section: "Warm Up" },
  { artist: "The Jackson 5", song: "I Want You Back", genre: "Funk", decade: "1970s", energy: 6, danceability: 8, section: "Warm Up" },
  { artist: "Bill Withers", song: "Lovely Day", genre: "Soul", decade: "1970s", energy: 5, danceability: 6, section: "Warm Up" },
  { artist: "ABBA", song: "Dancing Queen", genre: "Disco", decade: "1970s", energy: 7, danceability: 9, section: "Warm Up" },
  { artist: "KC and the Sunshine Band", song: "Get Down Tonight", genre: "Disco", decade: "1970s", energy: 7, danceability: 9, section: "Warm Up" },
  { artist: "Bee Gees", song: "Stayin' Alive", genre: "Disco", decade: "1970s", energy: 7, danceability: 9, section: "Warm Up" },
  { artist: "Van Morrison", song: "Brown Eyed Girl", genre: "Rock", decade: "1960s", energy: 5, danceability: 6, section: "Warm Up" },
  { artist: "The Temptations", song: "My Girl", genre: "Soul", decade: "1960s", energy: 5, danceability: 6, section: "Warm Up" },
  { artist: "Neil Diamond", song: "Sweet Caroline", genre: "Pop", decade: "1960s", energy: 6, danceability: 6, section: "Warm Up" },
  { artist: "Whitney Houston", song: "I Wanna Dance with Somebody", genre: "Pop", decade: "1980s", energy: 7, danceability: 8, section: "Warm Up" },
  { artist: "Michael Jackson", song: "Billie Jean", genre: "Pop", decade: "1980s", energy: 7, danceability: 9, section: "Warm Up" },
  { artist: "Journey", song: "Don't Stop Believin'", genre: "Rock", decade: "1980s", energy: 7, danceability: 6, section: "Warm Up" },
  { artist: "Hall & Oates", song: "You Make My Dreams", genre: "Pop", decade: "1980s", energy: 6, danceability: 7, section: "Warm Up" },
  { artist: "Bon Jovi", song: "Livin' on a Prayer", genre: "Rock", decade: "1980s", energy: 7, danceability: 6, section: "Warm Up" },
  { artist: "Bruno Mars", song: "Marry You", genre: "Pop", decade: "2010s", energy: 6, danceability: 7, section: "Warm Up" },
  { artist: "Taylor Swift", song: "Shake It Off", genre: "Pop", decade: "2010s", energy: 7, danceability: 8, section: "Warm Up" },

  // Transition — modern pop, alt, 2000s/2010s
  { artist: "Justin Timberlake", song: "Can't Stop the Feeling!", genre: "Pop", decade: "2010s", energy: 7, danceability: 8, section: "Transition" },
  { artist: "Mark Ronson", song: "Uptown Funk", genre: "Pop", decade: "2010s", energy: 8, danceability: 9, section: "Transition" },
  { artist: "OutKast", song: "Hey Ya!", genre: "Hip Hop", decade: "2000s", energy: 7, danceability: 8, section: "Transition" },
  { artist: "Black Eyed Peas", song: "I Gotta Feeling", genre: "Pop", decade: "2000s", energy: 8, danceability: 9, section: "Transition" },
  { artist: "Maroon 5", song: "Sugar", genre: "Pop", decade: "2010s", energy: 7, danceability: 8, section: "Transition" },
  { artist: "Dua Lipa", song: "Levitating", genre: "Pop", decade: "2020s", energy: 7, danceability: 9, section: "Transition" },
  { artist: "Harry Styles", song: "As It Was", genre: "Pop", decade: "2020s", energy: 6, danceability: 7, section: "Transition" },
  { artist: "The Killers", song: "Mr. Brightside", genre: "Alternative Rock", decade: "2000s", energy: 8, danceability: 6, section: "Transition" },
  { artist: "Blink-182", song: "All the Small Things", genre: "Pop Punk", decade: "2000s", energy: 8, danceability: 6, section: "Transition" },
  { artist: "Kelly Clarkson", song: "Since U Been Gone", genre: "Pop", decade: "2000s", energy: 8, danceability: 7, section: "Transition" },
  { artist: "Beyoncé", song: "Crazy in Love", genre: "Pop", decade: "2000s", energy: 8, danceability: 9, section: "Transition" },
  { artist: "Rihanna", song: "We Found Love", genre: "Pop", decade: "2010s", energy: 8, danceability: 9, section: "Transition" },
  { artist: "Lady Gaga", song: "Just Dance", genre: "Pop", decade: "2000s", energy: 8, danceability: 9, section: "Transition" },
  { artist: "Katy Perry", song: "Teenage Dream", genre: "Pop", decade: "2010s", energy: 7, danceability: 8, section: "Transition" },
  { artist: "Ed Sheeran", song: "Shape of You", genre: "Pop", decade: "2010s", energy: 7, danceability: 9, section: "Transition" },
  { artist: "Doja Cat", song: "Say So", genre: "Pop", decade: "2020s", energy: 7, danceability: 9, section: "Transition" },

  // Peak — high-energy EDM, party, closers
  { artist: "Pitbull", song: "Give Me Everything", genre: "EDM", decade: "2010s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "Flo Rida", song: "Low", genre: "Hip Hop", decade: "2000s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "Flo Rida", song: "Good Feeling", genre: "EDM", decade: "2010s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "David Guetta", song: "Titanium", genre: "EDM", decade: "2010s", energy: 9, danceability: 8, section: "Peak" },
  { artist: "Calvin Harris", song: "Summer", genre: "EDM", decade: "2010s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "Avicii", song: "Wake Me Up", genre: "EDM", decade: "2010s", energy: 9, danceability: 8, section: "Peak" },
  { artist: "Lady Gaga", song: "Bad Romance", genre: "Pop", decade: "2010s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "Rihanna", song: "Don't Stop the Music", genre: "Pop", decade: "2000s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "Usher", song: "Yeah!", genre: "Hip Hop", decade: "2000s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "LMFAO", song: "Party Rock Anthem", genre: "EDM", decade: "2010s", energy: 10, danceability: 10, section: "Peak" },
  { artist: "Kesha", song: "TiK ToK", genre: "Pop", decade: "2010s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "Taio Cruz", song: "Dynamite", genre: "Pop", decade: "2010s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "Bruno Mars", song: "24K Magic", genre: "Pop", decade: "2010s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "The Weeknd", song: "Blinding Lights", genre: "Pop", decade: "2020s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "Lizzo", song: "Good as Hell", genre: "Pop", decade: "2010s", energy: 8, danceability: 8, section: "Peak" },
  { artist: "Cardi B", song: "I Like It", genre: "Hip Hop", decade: "2010s", energy: 9, danceability: 9, section: "Peak" },
  { artist: "Pitbull", song: "Timber", genre: "EDM", decade: "2010s", energy: 10, danceability: 10, section: "Peak" },
  { artist: "Journey", song: "Any Way You Want It", genre: "Rock", decade: "1980s", energy: 8, danceability: 6, section: "Peak" },
  { artist: "Garth Brooks", song: "Friends in Low Places", genre: "Country", decade: "1990s", energy: 8, danceability: 5, section: "Peak" },
  { artist: "Backstreet Boys", song: "Everybody (Backstreet's Back)", genre: "Pop", decade: "1990s", energy: 8, danceability: 8, section: "Peak" },
  { artist: "Spice Girls", song: "Wannabe", genre: "Pop", decade: "1990s", energy: 8, danceability: 8, section: "Peak" },
  { artist: "All-American Rejects", song: "Gives You Hell", genre: "Pop Punk", decade: "2000s", energy: 8, danceability: 6, section: "Peak" },
  { artist: "Fall Out Boy", song: "Sugar, We're Goin Down", genre: "Pop Punk", decade: "2000s", energy: 8, danceability: 6, section: "Peak" },
];
