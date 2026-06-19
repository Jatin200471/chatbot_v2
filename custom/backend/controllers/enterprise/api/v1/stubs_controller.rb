module Enterprise
  module Api
    module V1
      class StubsController < ::Api::BaseController
        def limits
          render json: { id: params[:id].to_i, limits: {} }, status: :ok
        end

        def noop
          render json: {}, status: :ok
        end
      end
    end
  end
end
