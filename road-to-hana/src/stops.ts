// Coordinates are [longitude, latitude]. Mile markers (MM) count from the
// start of Hana Highway (Route 360) near Kailua/Haʻikū.
export type Stop = {
	name: string;
	tag: string;
	description: string;
	coord: [number, number];
};

export const STOPS: Stop[] = [
	{
		name: 'Wailea',
		tag: 'Start',
		description: 'Sonnige Südküste – früh losfahren, die Straße wird schnell voll.',
		coord: [-156.4427, 20.688],
	},
	{
		name: 'Pāʻia',
		tag: 'Letzter Tankstopp',
		description: 'Surfer- & Hippie-Städtchen. Volltanken, Snacks und Bananenbrot einpacken.',
		coord: [-156.3805, 20.9125],
	},
	{
		name: 'Hoʻokipa Beach',
		tag: 'Aussichtspunkt',
		description: 'Weltklasse-Windsurfer und Meeresschildkröten, die am Strand dösen.',
		coord: [-156.3567, 20.9339],
	},
	{
		name: 'Twin Falls',
		tag: 'MM 2',
		description: 'Die ersten Wasserfälle – kurzer Spaziergang durch den Regenwald.',
		coord: [-156.244, 20.9118],
	},
	{
		name: 'Garden of Eden',
		tag: 'MM 10.5',
		description: 'Arboretum mit Pfauen, Regenbogen-Eukalyptus und Blick auf die Puohokamoa-Fälle.',
		coord: [-156.2101, 20.8997],
	},
	{
		name: 'Keʻanae Halbinsel',
		tag: 'MM 16.5',
		description: 'Schwarze Lavaküste, tosende Brandung und Tante Sandy’s Bananenbrot.',
		coord: [-156.1474, 20.8596],
	},
	{
		name: 'Upper Waikani Falls',
		tag: 'MM 19',
		description: 'Die „Three Bears Falls“ – drei Fälle direkt an der Brücke.',
		coord: [-156.1386, 20.8323],
	},
	{
		name: 'Waiʻānapanapa',
		tag: 'MM 32',
		description: 'Schwarzer Sandstrand, Lavahöhlen und Meeresbögen. Reservierung nötig!',
		coord: [-156.0026, 20.788],
	},
	{
		name: 'Hāna',
		tag: 'Ziel',
		description: 'Angekommen im alten Hawaiʻi – entschleunigt, grün und ursprünglich.',
		coord: [-155.9876, 20.7568],
	},
];
