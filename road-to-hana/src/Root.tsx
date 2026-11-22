import {Composition} from 'remotion';
import {FPS, TIMELINE} from './geo';
import {RoadToHana} from './RoadToHana';

export const RemotionRoot: React.FC = () => (
	<Composition
		id="RoadToHana"
		component={RoadToHana}
		durationInFrames={TIMELINE.total}
		fps={FPS}
		width={1920}
		height={1080}
	/>
);
