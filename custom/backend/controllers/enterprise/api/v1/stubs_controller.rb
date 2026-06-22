module Enterprise
  module Api
    module V1
      class StubsController < ActionController::API
        def limits
          render json: { id: params[:id].to_i, limits: {} }, status: :ok
        end

        def noop
          render json: { success: true }, status: :ok
        end
      end
    end
  end
end
