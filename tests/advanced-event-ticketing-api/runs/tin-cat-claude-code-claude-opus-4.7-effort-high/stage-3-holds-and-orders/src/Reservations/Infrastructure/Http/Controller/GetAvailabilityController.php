<?php

declare(strict_types=1);

namespace Frontstage\Reservations\Infrastructure\Http\Controller;

use Frontstage\Reservations\Application\Bus\QueryBus;
use Frontstage\Reservations\Application\Query\GetAvailability\GetAvailabilityQuery;
use Frontstage\Reservations\Application\Query\View\EventAvailabilityView;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class GetAvailabilityController
{
	public function __construct(private readonly QueryBus $queries)
	{
	}

	#[Route('/events/{id}/availability', name: 'reservations_event_availability', methods: ['GET'])]
	public function __invoke(string $id): Response
	{
		/** @var EventAvailabilityView $view */
		$view = $this->queries->ask(new GetAvailabilityQuery($id));

		return new JsonResponse($view->toArray(), Response::HTTP_OK);
	}
}
