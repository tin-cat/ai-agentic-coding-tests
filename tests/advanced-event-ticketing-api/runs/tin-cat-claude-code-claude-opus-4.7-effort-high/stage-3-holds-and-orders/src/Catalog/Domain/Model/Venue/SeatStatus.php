<?php

declare(strict_types=1);

namespace Frontstage\Catalog\Domain\Model\Venue;

enum SeatStatus: string
{
	case Available = 'available';
	case Held = 'held';
	case Sold = 'sold';
}
